// Slack relay for DJ replies, using fetch against the Slack Web API (no SDK).
//
// DJ texts the DJ line -> posted in the private staff channel, one thread
// per DJ. Staff reply in that thread -> routes/slackEvents.js texts the reply
// to the DJ from DJ_TWILIO_PHONE_NUMBER.
//
// SLACK_DRY_RUN=true: every Web API call is logged and returns a fake ts.
// Slack is "off" unless SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET and
// SLACK_DJ_CHANNEL_ID are all set; DJ replies are still saved either way.
const crypto = require('crypto');
const pool = require('../config/database');

const SLACK_API = 'https://slack.com/api/';
const THREAD_DAYS = () => parseInt(process.env.DJ_SLACK_THREAD_DAYS || '7', 10);

const isConfigured = () => Boolean(
  process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_DJ_CHANNEL_ID
);
const channelId = () => process.env.SLACK_DJ_CHANNEL_ID;
const isDryRun = () => process.env.SLACK_DRY_RUN === 'true';

// In-memory record of dry-run calls for tests.
const dryRun = {
  calls: [],
  reset() { this.calls.length = 0; }
};

let fakeTsCounter = 0;
const fakeTs = () => {
  fakeTsCounter += 1;
  return `${Math.floor(Date.now() / 1000)}.${String(fakeTsCounter).padStart(6, '0')}`;
};

/** Call one Slack Web API method. Throws on transport or `ok: false`. */
const callApi = async (method, payload) => {
  if (isDryRun()) {
    const ts = fakeTs();
    dryRun.calls.push({ method, payload, ts });
    console.log(`[slack-dry-run] ${method} ${JSON.stringify(payload)}`);
    return { ok: true, ts, channel: payload.channel };
  }
  if (process.env.NODE_ENV === 'test') {
    throw new Error('Refusing to call the real Slack API under NODE_ENV=test (set SLACK_DRY_RUN=true)');
  }
  const res = await fetch(SLACK_API + method, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error || res.status}`);
  }
  return data;
};

// Slack mrkdwn treats &, < and > as control characters.
const escapeForSlack = (text) => String(text || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * Turn a Slack message's text into plain SMS text: links become
 * "label (url)" or the bare url, user/channel/special mentions are dropped,
 * and Slack's entity escapes are decoded last so a typed "&lt;" stays literal.
 */
const slackToPlainText = (text) => String(text || '')
  .replace(/<([@#!][^>]*)>/g, '')
  .replace(/<([^>|]+)\|([^>]+)>/g, '$2 ($1)')
  .replace(/<([^>]+)>/g, '$1')
  .replace(/[ \t]{2,}/g, ' ')
  .trim()
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const hasName = (dj) =>
  Boolean(dj && (dj.first_name || '').trim() && (dj.last_name || '').trim());

/** How a DJ is named in Slack: name and show, or the last 4 digits. */
const djLabel = (dj) => {
  let label;
  if (hasName(dj)) {
    label = `*${escapeForSlack(`${dj.first_name.trim()} ${dj.last_name.trim()}`)}*`;
    if (dj.show_name && dj.show_name.trim()) label += ` (${escapeForSlack(dj.show_name.trim())})`;
  } else {
    label = `*Name not on file* (number ending ${escapeForSlack(String(dj.phone_number).slice(-4))})`;
  }
  if (dj.active === false) label += ' _(removed from roster)_';
  return label;
};

/**
 * Post a saved dj_inbound_messages row to the staff channel. Continues the
 * DJ's thread if it was active within DJ_SLACK_THREAD_DAYS, otherwise starts
 * a new top-level message and records it as the DJ's thread. Never throws:
 * a Slack failure is logged and the saved row is kept.
 */
const postDjReply = async (inbound, dj) => {
  if (!isConfigured()) return null;
  try {
    const channel = channelId();
    const { rows: [thread] } = await pool.query(
      `SELECT * FROM dj_slack_threads
       WHERE dj_id = $1 AND channel_id = $2
         AND last_message_at >= NOW() - ($3 * INTERVAL '1 day')
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [dj.id, channel, THREAD_DAYS()]
    );

    const text = `${djLabel(dj)}\n${escapeForSlack(inbound.body)}`;
    const payload = { channel, text, unfurl_links: false, unfurl_media: false };
    if (thread) payload.thread_ts = thread.thread_ts;

    const result = await callApi('chat.postMessage', payload);
    const threadTs = thread ? thread.thread_ts : result.ts;

    if (thread) {
      await pool.query('UPDATE dj_slack_threads SET last_message_at = NOW() WHERE id = $1', [thread.id]);
    } else {
      await pool.query(
        `INSERT INTO dj_slack_threads (dj_id, channel_id, thread_ts, last_message_at)
         VALUES ($1, $2, $3, NOW())`,
        [dj.id, channel, threadTs]
      );
    }
    await pool.query(
      'UPDATE dj_inbound_messages SET slack_ts = $1, slack_thread_ts = $2 WHERE id = $3',
      [result.ts, threadTs, inbound.id]
    );
    return { ts: result.ts, threadTs };
  } catch (err) {
    console.error(`[slack] could not post DJ reply ${inbound.id}:`, err.message);
    return null;
  }
};

/** Reply in a thread (bot notices like "not sent because ..."). Never throws. */
const postThreadNotice = async (threadTs, text) => {
  try {
    return await callApi('chat.postMessage', { channel: channelId(), thread_ts: threadTs, text });
  } catch (err) {
    console.error('[slack] could not post thread notice:', err.message);
    return null;
  }
};

const addReaction = async (ts, name) => {
  try {
    return await callApi('reactions.add', { channel: channelId(), timestamp: ts, name });
  } catch (err) {
    console.error('[slack] could not add reaction:', err.message);
    return null;
  }
};

/**
 * Verify a Slack request signature (https://api.slack.com/authentication/verifying-requests-from-slack).
 * Rejects a timestamp more than 300 seconds from now (replay protection).
 */
const verifySignature = ({ rawBody, timestamp, signature, secret, nowSeconds = Math.floor(Date.now() / 1000) }) => {
  if (!secret || !timestamp || !signature || rawBody == null) return false;
  if (!/^\d+$/.test(String(timestamp))) return false;
  if (Math.abs(nowSeconds - parseInt(timestamp, 10)) > 300) return false;
  const base = `v0:${timestamp}:${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

module.exports = {
  isConfigured,
  channelId,
  callApi,
  escapeForSlack,
  slackToPlainText,
  djLabel,
  hasName,
  postDjReply,
  postThreadNotice,
  addReaction,
  verifySignature,
  dryRun
};
