// Inbound texts to the DJ line (POST /webhook/dj-sms).
//
// Kept apart from the listener flow on purpose: nothing here reads or writes
// messages or contacts, and nothing emits message:new, so a DJ's text can
// never reach the on-air screen. Outbound texts go from DJ_TWILIO_PHONE_NUMBER
// only. Keywords are trimmed and case-insensitive. See DJ_TEXTING.md.
const pool = require('../config/database');
const twilioService = require('./twilio');
const slack = require('./slack');

const { MESSAGES } = twilioService;
const MAX_NAME_REQUESTS = 3;
const NAME_MAX_LENGTH = 100;

// Same STOP list as the listener webhook (routes/webhook.js).
const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke'];
const START_WORDS = ['start', 'unstop'];
const HELP_WORDS = ['help', 'info'];
const YES_WORDS = ['yes', 'y'];
const JOIN_WORD = 'dj';

const logConsent = async (phone, actionType, userMessage, systemResponse = null) => {
  try {
    await pool.query(
      `INSERT INTO dj_consent_log (phone_number, action_type, method, user_message, system_response)
       VALUES ($1, $2, 'sms', $3, $4)`,
      [phone, actionType, userMessage, systemResponse]
    );
  } catch (err) {
    console.error('[dj-sms] could not write consent log:', err.message);
  }
};

// Sends from the DJ number or not at all. A send failure is logged and the
// webhook carries on; Twilio still gets its empty TwiML.
const sendFromDjLine = async (to, body) => {
  const from = twilioService.djFromNumber();
  if (!from) {
    console.warn('[dj-sms] DJ_TWILIO_PHONE_NUMBER is not set; not replying to', to);
    return null;
  }
  try {
    return await twilioService.sendSMS(to, body, { from });
  } catch (err) {
    console.error('[dj-sms] send failed:', err.message);
    if (err.code === 21610) {
      await pool.query(
        `UPDATE dj_roster SET opted_out = true, opted_out_timestamp = COALESCE(opted_out_timestamp, NOW())
         WHERE phone_number = $1`,
        [to]
      );
    }
    return null;
  }
};

const nameMissing = (dj) => !slack.hasName(dj);

/**
 * Parse a texted name. Trims and collapses spaces; two or more words means
 * first word = first_name, the rest = last_name. Returns null for one word
 * or a part longer than 100 characters.
 */
const parseName = (text) => {
  const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  const words = cleaned.split(' ');
  if (words.length < 2) return null;
  const firstName = words[0];
  const lastName = words.slice(1).join(' ');
  if (firstName.length > NAME_MAX_LENGTH || lastName.length > NAME_MAX_LENGTH) return null;
  return { firstName, lastName };
};

/**
 * Ask a signed-up DJ for their name, at most MAX_NAME_REQUESTS times in
 * total. After that, staff fill it in on /admin/djs. Returns true if asked.
 */
const askForName = async (dj, userMessage) => {
  if (!nameMissing(dj)) return false;
  if (dj.name_request_count >= MAX_NAME_REQUESTS) {
    // Out of asks. Stop treating texts as name answers so later replies
    // reach Slack instead of disappearing into the name parser.
    if (dj.name_requested_at) {
      await pool.query('UPDATE dj_roster SET name_requested_at = NULL WHERE id = $1', [dj.id]);
    }
    await logConsent(dj.phone_number, 'name_request_limit', userMessage);
    return false;
  }
  await pool.query(
    `UPDATE dj_roster
     SET name_requested_at = NOW(), name_request_count = name_request_count + 1
     WHERE id = $1`,
    [dj.id]
  );
  await sendFromDjLine(dj.phone_number, MESSAGES.DJ_NAME_REQUEST);
  await logConsent(dj.phone_number, 'name_request', userMessage, MESSAGES.DJ_NAME_REQUEST);
  return true;
};

const saveInbound = async (dj, phone, body) => {
  const { rows: [row] } = await pool.query(
    `INSERT INTO dj_inbound_messages (dj_id, phone_number, body)
     VALUES ($1, $2, $3) RETURNING *`,
    [dj ? dj.id : null, phone, body]
  );
  return row;
};

/**
 * Handle one inbound DJ-line text. Returns { afterResponse } where
 * afterResponse is an optional function to run once Twilio has its answer
 * (the Slack post).
 */
const handleInbound = async (from, body) => {
  const keyword = body.trim().toLowerCase();
  const { rows: [dj] } = await pool.query('SELECT * FROM dj_roster WHERE phone_number = $1', [from]);
  const activeDj = dj && dj.active && !dj.opted_out ? dj : null;

  // STOP: Twilio's Advanced Opt-Out sends the confirmation; we only record it.
  if (STOP_WORDS.includes(keyword)) {
    if (dj) {
      await pool.query(
        'UPDATE dj_roster SET opted_out = true, opted_out_timestamp = NOW() WHERE id = $1',
        [dj.id]
      );
    }
    await logConsent(from, 'opt_out', body);
    return {};
  }

  // START/UNSTOP lifts the opt-out but doesn't sign them up: opted_in is left
  // as it was, so a DJ who never replied YES still has to.
  if (START_WORDS.includes(keyword)) {
    if (dj) {
      await pool.query(
        'UPDATE dj_roster SET opted_out = false, opted_out_timestamp = NULL WHERE id = $1',
        [dj.id]
      );
    }
    await logConsent(from, 'opt_out_cleared', body);
    return {};
  }

  if (HELP_WORDS.includes(keyword)) {
    await logConsent(from, 'help_request', body);
    return {};
  }

  if (keyword === JOIN_WORD) {
    if (activeDj && !activeDj.opted_in) {
      await pool.query('UPDATE dj_roster SET opt_in_requested_at = NOW() WHERE id = $1', [activeDj.id]);
      await sendFromDjLine(from, MESSAGES.DJ_OPT_IN_REQUEST);
      await logConsent(from, 'request', body, MESSAGES.DJ_OPT_IN_REQUEST);
    } else if (activeDj) {
      await sendFromDjLine(from, MESSAGES.DJ_OPT_IN_CONFIRMATION);
      await logConsent(from, 'already_opted_in', body, MESSAGES.DJ_OPT_IN_CONFIRMATION);
      await askForName(activeDj, body);
    } else if (dj && dj.opted_out) {
      await logConsent(from, 'join_while_opted_out', body);
    } else {
      // Not on the roster (or removed). One polite reply per number per day.
      const { rows: [recent] } = await pool.query(
        `SELECT 1 FROM dj_consent_log
         WHERE phone_number = $1 AND action_type = 'not_on_roster_reply'
           AND timestamp >= NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [from]
      );
      if (recent) {
        await logConsent(from, 'not_on_roster', body);
      } else {
        await sendFromDjLine(from, MESSAGES.DJ_NOT_ON_ROSTER);
        await logConsent(from, 'not_on_roster_reply', body, MESSAGES.DJ_NOT_ON_ROSTER);
      }
    }
    return {};
  }

  if (YES_WORDS.includes(keyword)) {
    if (activeDj && !activeDj.opted_in && activeDj.opt_in_requested_at) {
      const { rows: [updated] } = await pool.query(
        `UPDATE dj_roster
         SET opted_in = true, opt_in_method = 'sms_keyword', opt_in_timestamp = NOW()
         WHERE id = $1 RETURNING *`,
        [activeDj.id]
      );
      await sendFromDjLine(from, MESSAGES.DJ_OPT_IN_CONFIRMATION);
      await logConsent(from, 'confirm', body, MESSAGES.DJ_OPT_IN_CONFIRMATION);
      await askForName(updated, body);
    } else {
      await logConsent(from, 'yes_without_request', body);
    }
    return {};
  }

  if (!dj) {
    // Not a DJ and not a keyword: log, no reply, nothing saved as a message.
    await logConsent(from, 'unknown_sender', body);
    return {};
  }

  // Waiting for this DJ's name: treat the text as the answer. Saved, but not
  // posted to Slack. (Removed or opted-out DJs fall through to the ordinary
  // path below and are never texted.)
  if (activeDj && activeDj.name_requested_at && nameMissing(activeDj)) {
    await saveInbound(activeDj, from, body);
    const parsed = parseName(body);
    if (parsed) {
      await pool.query(
        `UPDATE dj_roster SET first_name = $1, last_name = $2, name_requested_at = NULL WHERE id = $3`,
        [parsed.firstName, parsed.lastName, activeDj.id]
      );
      await sendFromDjLine(from, MESSAGES.DJ_NAME_THANKS);
      await logConsent(from, 'name_received', body, MESSAGES.DJ_NAME_THANKS);
    } else {
      await logConsent(from, 'name_unparsed', body);
      await askForName(activeDj, body);
    }
    return {};
  }

  // An ordinary reply from a roster number: save it, post it to Slack after
  // Twilio has its response.
  const inbound = await saveInbound(dj, from, body);
  return { afterResponse: () => slack.postDjReply(inbound, dj) };
};

module.exports = { handleInbound, parseName, MAX_NAME_REQUESTS };
