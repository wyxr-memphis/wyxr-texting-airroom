// POST /slack/events - Slack Events API endpoint for the DJ reply channel.
//
// A staff member replying inside a DJ's thread in SLACK_DJ_CHANNEL_ID gets
// that reply texted to the DJ from DJ_TWILIO_PHONE_NUMBER.
//
// Mounted in app.js BEFORE the global body parsers (the signature is
// computed over the raw body) and before the CSRF origin check (Slack sends
// no Origin header; it signs requests instead). See DJ_TEXTING.md.
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const slack = require('../services/slack');
const twilioService = require('../services/twilio');
const { isMessagingEnabled } = require('../services/broadcastWorker');
const { fullTextFor, measure } = require('../utils/smsText');
const { runAfterResponse } = require('../utils/afterResponse');

const MAX_REPLY_SEGMENTS = 3;

const recordOutcome = (id, fields) => pool.query(
  `UPDATE dj_outbound_replies
   SET status = $2, twilio_sid = $3, error = $4
   WHERE id = $1`,
  [id, fields.status, fields.twilioSid || null, fields.error || null]
);

// Why a reply can't go out, or null if it can.
const skipReason = async (dj) => {
  if (!twilioService.djFromNumber()) return 'DJ sending is off (DJ_TWILIO_PHONE_NUMBER is not set)';
  if (!(await isMessagingEnabled())) return 'messaging is paused (the messaging kill switch is off)';
  if (!dj.active) return 'this DJ has been removed from the roster';
  if (dj.opted_out) return 'this DJ has opted out (replied STOP)';
  if (!dj.opted_in) return 'this DJ has not signed up yet (they need to text DJ and reply YES)';
  return null;
};

/**
 * Act on one Slack event. Only a human reply inside a known DJ thread in
 * the DJ channel does anything; everything else is ignored.
 */
const handleEvent = async (event) => {
  if (!event || event.type !== 'message') return { ignored: 'not a message' };
  if (event.channel !== slack.channelId()) return { ignored: 'other channel' };
  if (event.subtype) return { ignored: `subtype ${event.subtype}` }; // edits, deletes, joins, bot posts
  if (event.bot_id) return { ignored: 'bot message' };
  if (!event.thread_ts || event.thread_ts === event.ts) return { ignored: 'not a thread reply' };

  const { rows: [thread] } = await pool.query(
    'SELECT * FROM dj_slack_threads WHERE thread_ts = $1 AND channel_id = $2',
    [event.thread_ts, event.channel]
  );
  if (!thread) return { ignored: 'unknown thread' };

  // Claim the event by its ts first. Slack retries slow deliveries, and the
  // UNIQUE slack_ts makes the second delivery a no-op instead of a second text.
  const { rows: [claimed] } = await pool.query(
    `INSERT INTO dj_outbound_replies (dj_id, slack_thread_ts, slack_ts, slack_user_id, body)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slack_ts) DO NOTHING
     RETURNING id`,
    [thread.dj_id, event.thread_ts, event.ts, event.user || null, event.text || '']
  );
  if (!claimed) return { ignored: 'duplicate' };

  const { rows: [dj] } = await pool.query('SELECT * FROM dj_roster WHERE id = $1', [thread.dj_id]);
  const plain = slack.slackToPlainText(event.text);

  if (!plain) {
    await recordOutcome(claimed.id, { status: 'skipped', error: 'empty message' });
    return { status: 'skipped', reason: 'empty message' };
  }

  const fullText = fullTextFor(plain, 'djs');
  const { segmentCount } = measure(fullText);
  if (segmentCount > MAX_REPLY_SEGMENTS) {
    const reason = `too long (${segmentCount} text segments, limit ${MAX_REPLY_SEGMENTS})`;
    await recordOutcome(claimed.id, { status: 'skipped', error: reason });
    await slack.postThreadNotice(
      event.thread_ts,
      `:warning: Not sent: that reply is ${reason}. Please send a shorter message.`
    );
    return { status: 'skipped', reason };
  }

  const reason = await skipReason(dj);
  if (reason) {
    await recordOutcome(claimed.id, { status: 'skipped', error: reason });
    await slack.postThreadNotice(event.thread_ts, `:no_entry: Not sent: ${reason}.`);
    return { status: 'skipped', reason };
  }

  try {
    const result = await twilioService.sendSMS(dj.phone_number, fullText, {
      from: twilioService.djFromNumber()
    });
    await recordOutcome(claimed.id, { status: 'sent', twilioSid: result.sid });
    await slack.addReaction(event.ts, 'white_check_mark');
    return { status: 'sent', sid: result.sid };
  } catch (err) {
    if (err.code === 21610) {
      await pool.query(
        `UPDATE dj_roster SET opted_out = true, opted_out_timestamp = COALESCE(opted_out_timestamp, NOW())
         WHERE id = $1`,
        [dj.id]
      );
      await recordOutcome(claimed.id, { status: 'failed', error: '21610: DJ opted out at the carrier' });
      await slack.postThreadNotice(
        event.thread_ts,
        ':no_entry: Not sent: this DJ has opted out of the DJ line at the carrier. They are now marked opted out.'
      );
      return { status: 'failed', reason: 'opted out at carrier' };
    }
    console.error('[slack-events] reply send failed:', err.message);
    await recordOutcome(claimed.id, { status: 'failed', error: `${err.code || ''} ${err.message}`.trim().slice(0, 500) });
    await slack.postThreadNotice(event.thread_ts, ':warning: Not sent: Twilio rejected the text. Try again later.');
    return { status: 'failed', reason: err.message };
  }
};

router.post('/events', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  if (!slack.isConfigured()) {
    return res.status(503).json({ error: 'Slack is not configured' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const valid = slack.verifySignature({
    rawBody,
    timestamp: req.get('X-Slack-Request-Timestamp'),
    signature: req.get('X-Slack-Signature'),
    secret: process.env.SLACK_SIGNING_SECRET
  });
  if (!valid) {
    console.warn('[slack-events] rejected request with bad or stale signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  // Answer Slack at once (it retries anything slower than 3 seconds), then
  // handle the event.
  res.status(200).end();
  if (payload.type === 'event_callback') {
    runAfterResponse('slack event', () => handleEvent(payload.event));
  }
});

module.exports = router;
module.exports.handleEvent = handleEvent;
