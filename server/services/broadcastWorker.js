// Background send worker for broadcasts.
//
// A broadcast to the full opted-in list takes minutes to tens of minutes at
// Twilio's ~1 msg/sec 10DLC throughput ceiling, so it cannot run inside an
// HTTP request. There is no queue infrastructure in this project, so the
// worker is a single always-on recursive setTimeout loop driven off row state
// in Postgres. That makes the send resumable for free: the loop doesn't care
// which process started a broadcast, only that one has status='sending'.
//
// See BROADCAST_MESSAGING_SPEC.md §7.
const pool = require('../config/database');
const twilioService = require('./twilio');
const { fullTextFor } = require('../utils/smsText');

const SEND_INTERVAL_MS = parseInt(process.env.BROADCAST_SEND_INTERVAL_MS || '1100', 10);
const MAX_ATTEMPTS = parseInt(process.env.BROADCAST_MAX_ATTEMPTS || '3', 10);

// Twilio error codes meaning "this number will never work" — no point retrying.
// twilio.js has historically labelled 21408/21610 as "waiting for A2P approval";
// that comment predates approval. They are permanent per-recipient failures.
const PERMANENT_ERROR_CODES = new Set([
  21610, // recipient opted out at the carrier / Advanced Opt-Out level
  21614, // 'To' number is not a valid mobile number
  21211, // invalid 'To' phone number
  21408, // region not enabled for this account
  21612, // unreachable via this route
  21617, // body exceeds the max message length
  21618  // message body cannot be empty
]);

let running = false;
let timer = null;

const isMessagingEnabled = async () => {
  const { rows } = await pool.query(
    "SELECT value FROM settings WHERE key = 'messaging_enabled'"
  );
  if (rows.length === 0) return true; // default enabled, matching routes/settings.js
  return rows[0].value === 'true';
};

const markFailed = async (broadcastId, recipientId, code, message) => {
  await pool.query(
    `UPDATE broadcast_recipients
     SET status = 'failed_permanent', error_code = $1, error_message = $2
     WHERE id = $3`,
    [String(code || 'unknown'), message ? String(message).slice(0, 500) : null, recipientId]
  );
  await pool.query(
    'UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = $1',
    [broadcastId]
  );
};

const handleSendError = async (broadcast, recipient, error) => {
  const code = error && error.code;

  if (code === 21610) {
    // Twilio's Advanced Opt-Out can intercept a STOP before it ever reaches
    // /webhook/sms, so contacts.opted_out can drift out of sync with what
    // Twilio already knows. Self-heal on discovery so future sends skip them.
    await pool.query(
      `UPDATE contacts
       SET opted_out = true, opted_out_timestamp = COALESCE(opted_out_timestamp, NOW())
       WHERE phone_number = $1`,
      [recipient.phone_number]
    );
  }

  if (PERMANENT_ERROR_CODES.has(code)) {
    await markFailed(broadcast.id, recipient.id, code, error.message);
    return;
  }

  // Transient: network blips, 20429 Twilio-side throttle, 3000x carrier
  // hiccups. attempt_count was already incremented by the claim query.
  if (recipient.attempt_count >= MAX_ATTEMPTS) {
    await markFailed(
      broadcast.id,
      recipient.id,
      code,
      `Max retries exceeded: ${error.message}`
    );
    return;
  }

  const backoffSeconds = 30 * Math.pow(2, recipient.attempt_count - 1); // 30s, 60s, 120s
  await pool.query(
    `UPDATE broadcast_recipients
     SET status = 'pending', error_code = $1, error_message = $2,
         claimed_at = NULL, next_attempt_at = NOW() + ($3 * INTERVAL '1 second')
     WHERE id = $4`,
    [
      String(code || 'unknown'),
      error.message ? String(error.message).slice(0, 500) : null,
      backoffSeconds,
      recipient.id
    ]
  );
};

const finishIfDrained = async (broadcast) => {
  const { rows: [{ outstanding }] } = await pool.query(
    `SELECT COUNT(*) AS outstanding
     FROM broadcast_recipients
     WHERE broadcast_id = $1 AND status IN ('pending', 'sending')`,
    [broadcast.id]
  );

  if (parseInt(outstanding, 10) === 0) {
    await pool.query(
      `UPDATE broadcasts SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'sending'`,
      [broadcast.id]
    );
    console.log(`[broadcast-worker] broadcast ${broadcast.id} completed`);
  }
};

const sendNextRecipient = async (broadcast) => {
  // Claim one row atomically: the UPDATE ... RETURNING flips it out of
  // 'pending' in the same statement that selects it, so no other tick (or
  // instance) can pick up the same recipient. This is the primary guarantee
  // against double-texting.
  const { rows: [recipient] } = await pool.query(
    `UPDATE broadcast_recipients
     SET status = 'sending', claimed_at = NOW(), attempt_count = attempt_count + 1
     WHERE id = (
       SELECT id FROM broadcast_recipients
       WHERE broadcast_id = $1
         AND status = 'pending'
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [broadcast.id]
  );

  if (!recipient) {
    // Nothing claimable. Either the broadcast is done, or every remaining row
    // is waiting out a retry backoff — finishIfDrained distinguishes them.
    await finishIfDrained(broadcast);
    return;
  }

  try {
    const result = await twilioService.sendSMS(
      recipient.phone_number,
      fullTextFor(broadcast.body)
    );
    await pool.query(
      `UPDATE broadcast_recipients
       SET status = 'sent', twilio_sid = $1, sent_at = NOW(), error_code = NULL, error_message = NULL
       WHERE id = $2`,
      [result.sid, recipient.id]
    );
    await pool.query(
      'UPDATE broadcasts SET sent_count = sent_count + 1 WHERE id = $1',
      [broadcast.id]
    );
  } catch (error) {
    await handleSendError(broadcast, recipient, error);
  }
};

/**
 * Reconcile rows left claimed by a worker that died mid-send.
 *
 * A row stuck at status='sending' is ambiguous: the process may have crashed
 * before calling Twilio, or after Twilio accepted the message but before the
 * DB recorded it. Guessing wrong in one direction double-texts a listener, so
 * ask Twilio what it actually sent rather than trusting local state.
 */
const resumeInterruptedBroadcasts = async () => {
  const { rows: stuck } = await pool.query(
    `SELECT r.*, b.body, b.started_at, b.status AS broadcast_status
     FROM broadcast_recipients r
     JOIN broadcasts b ON b.id = r.broadcast_id
     WHERE r.status = 'sending'
       AND r.claimed_at < NOW() - INTERVAL '2 minutes'`
  );

  if (stuck.length === 0) return;
  console.log(`[broadcast-worker] reconciling ${stuck.length} interrupted send(s)`);

  for (const row of stuck) {
    try {
      const expected = fullTextFor(row.body);
      const recent = await twilioService.listMessagesTo(
        row.phone_number,
        row.started_at || row.claimed_at
      );
      const alreadySent = recent.find((m) => m.body === expected);

      if (alreadySent) {
        await pool.query(
          `UPDATE broadcast_recipients
           SET status = 'sent', twilio_sid = $1, sent_at = $2
           WHERE id = $3`,
          [alreadySent.sid, alreadySent.dateSent || new Date(), row.id]
        );
        await pool.query(
          'UPDATE broadcasts SET sent_count = sent_count + 1 WHERE id = $1',
          [row.broadcast_id]
        );
        console.log(`[broadcast-worker] ${row.phone_number} had already been sent — not resending`);
      } else if (row.broadcast_status === 'sending') {
        // Never made it to Twilio — put it back in the queue.
        await pool.query(
          `UPDATE broadcast_recipients
           SET status = 'pending', claimed_at = NULL
           WHERE id = $1`,
          [row.id]
        );
      } else {
        // The broadcast was canceled (or otherwise finished) while this row was
        // claimed. It was never sent and never will be, so retire it as skipped
        // rather than leaving it stuck at 'sending' forever.
        await pool.query(
          "UPDATE broadcast_recipients SET status = 'skipped', claimed_at = NULL WHERE id = $1",
          [row.id]
        );
        await pool.query(
          'UPDATE broadcasts SET skipped_count = skipped_count + 1 WHERE id = $1',
          [row.broadcast_id]
        );
      }
    } catch (err) {
      // If Twilio can't be reached we cannot safely decide. Leaving the row
      // claimed is the conservative choice: a missed text beats a duplicate,
      // and the next boot will retry this reconciliation.
      console.error(
        `[broadcast-worker] could not reconcile recipient ${row.id} (${row.phone_number}):`,
        err.message
      );
    }
  }
};

const tick = async () => {
  try {
    const { rows: [broadcast] } = await pool.query(
      "SELECT * FROM broadcasts WHERE status = 'sending' ORDER BY started_at LIMIT 1"
    );

    if (broadcast && (await isMessagingEnabled())) {
      await sendNextRecipient(broadcast);
    }
    // If messaging is globally disabled the broadcast simply pauses here and
    // resumes when staff flip the toggle back on — see spec §11.
  } catch (err) {
    console.error('[broadcast-worker] tick error:', err.message);
  } finally {
    if (running) {
      timer = setTimeout(tick, SEND_INTERVAL_MS);
    }
  }
};

const start = () => {
  if (running) return;
  running = true;
  console.log(`[broadcast-worker] started (interval ${SEND_INTERVAL_MS}ms)`);
  resumeInterruptedBroadcasts()
    .catch((err) => console.error('[broadcast-worker] resume failed:', err.message))
    .finally(() => tick());
};

const stop = () => {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
};

module.exports = {
  start,
  stop,
  // exported for tests
  resumeInterruptedBroadcasts,
  sendNextRecipient,
  PERMANENT_ERROR_CODES
};
