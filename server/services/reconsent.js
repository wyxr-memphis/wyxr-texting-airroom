// Re-permission flow for CSV-imported contacts.
//
// The imported contacts came from Mailchimp exports of people who had opted in
// to SMS there. That is real consent, but it lives in another system: our
// opt_in_log records only a staff attestation, the A2P campaign registration
// doesn't name Mailchimp as a consent path, and — the sharpest problem — all
// but one of these numbers has never exchanged a message with our Twilio
// number. A first-ever outbound to a large block of cold numbers is the
// pattern carrier spam filters key on, and filtering degrades the number for
// everything, including ordinary DJ replies.
//
// So instead of trusting the flag, we ask. Each contact gets the standard
// opt-in request; replying YES runs the normal webhook path, which rewrites
// opt_in_method to 'sms' and logs a real confirmation. They then enter the
// broadcast audience automatically with consent captured on our own number.
//
// See BROADCAST_MESSAGING_SPEC.md §8.3.
const pool = require('../config/database');
const twilioService = require('./twilio');

const SEND_INTERVAL_MS = parseInt(process.env.RECONSENT_SEND_INTERVAL_MS || '1100', 10);

// One run at a time. This is a manual, occasional action, so an in-memory
// guard is enough — a second click while a run is active gets a clear 409
// rather than double-texting anyone.
let activeRun = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Contacts eligible for a re-permission request:
 *   - came in via CSV import and still carry a staff-attested opt-in
 *   - not opted out, not blocked
 *   - haven't already been asked (idempotency — never ask twice)
 */
const findCandidates = async () => {
  const { rows } = await pool.query(
    `SELECT c.phone_number
     FROM contacts c
     WHERE c.opt_in_method = 'import'
       AND c.opted_in = true
       AND c.opted_out = false
       AND NOT EXISTS (
         SELECT 1 FROM blocked_numbers b WHERE b.phone = c.phone_number
       )
       AND NOT EXISTS (
         SELECT 1 FROM opt_in_log l
         WHERE l.phone_number = c.phone_number
           AND l.action_type = 'reconsent_request'
       )
     ORDER BY c.phone_number`
  );
  return rows.map((r) => r.phone_number);
};

/**
 * Send the opt-in request to each candidate, rate limited to stay under
 * Twilio's 10DLC throughput ceiling.
 *
 * Per contact the order matters: send first, and only move the contact to
 * pending once Twilio has accepted it. If the send fails we leave the contact
 * exactly as it was, so the run can safely be repeated for the stragglers
 * without re-texting anyone who already got the request.
 */
const runReconsentCampaign = async (candidates, actor) => {
  let sent = 0;
  const failures = [];

  for (const phone of candidates) {
    try {
      const result = await twilioService.sendSMS(phone, twilioService.MESSAGES.OPT_IN_REQUEST);
      if (!result) throw new Error('Twilio returned no result');

      // Moving them to pending is what makes a YES reply convert them: the
      // webhook's confirmation branch only runs for !opted_in && !opted_out.
      // Until they confirm they're out of the broadcast audience, which is the
      // honest state — we've asked and haven't heard back.
      await pool.query(
        `UPDATE contacts
         SET opted_in = false,
             opt_in_timestamp = NULL,
             pending_timestamp = NOW()
         WHERE phone_number = $1`,
        [phone]
      );

      await pool.query(
        `INSERT INTO opt_in_log (phone_number, action_type, method, system_response, consent_text)
         VALUES ($1, 'reconsent_request', 'import', $2, $3)`,
        [
          phone,
          twilioService.MESSAGES.OPT_IN_REQUEST,
          `Re-permission request sent by ${actor || 'admin'}; original basis was a Mailchimp `
            + 'SMS opt-in imported via CSV. Awaiting YES confirmation on our own number.'
        ]
      );

      sent += 1;
    } catch (error) {
      console.error(`[reconsent] failed for ${phone}:`, error.message);
      failures.push({ phone, error: error.message });
    }

    await sleep(SEND_INTERVAL_MS);
  }

  console.log(`[reconsent] run complete: ${sent} sent, ${failures.length} failed`);
  return { sent, failures };
};

/**
 * Kick off a run in the background and return immediately — 73 contacts at
 * ~1.1s each is well past an HTTP timeout.
 */
const startRun = async (actor) => {
  if (activeRun) {
    const err = new Error('A re-permission run is already in progress');
    err.code = 'RECONSENT_ACTIVE';
    throw err;
  }

  const candidates = await findCandidates();
  if (candidates.length === 0) return { queued: 0 };

  activeRun = runReconsentCampaign(candidates, actor)
    .catch((err) => console.error('[reconsent] run error:', err.message))
    .finally(() => { activeRun = null; });

  return { queued: candidates.length };
};

const isRunning = () => activeRun !== null;

module.exports = { findCandidates, startRun, isRunning, runReconsentCampaign };
