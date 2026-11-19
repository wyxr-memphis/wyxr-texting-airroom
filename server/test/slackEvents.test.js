const h = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifySignature } = require('../services/slack');

const THREAD = '1700000000.000100';
let dj;

before(async () => {
  await h.resetDb();
  await h.startApp();
});
after(h.stopApp);
beforeEach(async () => {
  await h.pool.query(`TRUNCATE dj_roster, dj_slack_threads, dj_outbound_replies, dj_inbound_messages RESTART IDENTITY CASCADE`);
  await h.pool.query(`UPDATE settings SET value = 'true' WHERE key = 'messaging_enabled'`);
  h.twilioService.dryRun.reset();
  h.slack.dryRun.reset();
  process.env.DJ_TWILIO_PHONE_NUMBER = h.DJ_NUMBER;
  dj = await h.addDj({ phone_number: h.fake(110), first_name: 'Ana', last_name: 'Lee' });
  await h.pool.query(
    `INSERT INTO dj_slack_threads (dj_id, channel_id, thread_ts) VALUES ($1, 'CFAKECHAN', $2)`,
    [dj.id, THREAD]
  );
});

let tsCounter = 200;
const staffReply = (fields = {}) => ({
  type: 'event_callback',
  event: {
    type: 'message',
    channel: 'CFAKECHAN',
    user: 'UFAKESTAFF',
    text: 'See you Thursday',
    ts: `1700000001.${String(tsCounter++).padStart(6, '0')}`,
    thread_ts: THREAD,
    ...fields
  }
});

const sent = () => h.twilioService.dryRun.outbox.map(({ to, from, body }) => ({ to, from, body }));
const slackCalls = () => h.slack.dryRun.calls.map(({ method, payload }) => ({ method, payload }));
const replies = async () =>
  (await h.pool.query('SELECT status, error, twilio_sid IS NOT NULL AS has_sid FROM dj_outbound_replies ORDER BY id')).rows;

describe('signature check', () => {
  const secret = 'fake-signing-secret';
  const sign = (ts, body) => 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  const now = 1700000000;

  test('unit: good, bad, stale and future timestamps', () => {
    const body = '{"a":1}';
    assert.equal(verifySignature({ rawBody: body, timestamp: String(now), signature: sign(now, body), secret, nowSeconds: now }), true);
    assert.equal(verifySignature({ rawBody: body, timestamp: String(now), signature: sign(now, '{"a":2}'), secret, nowSeconds: now }), false);
    assert.equal(verifySignature({ rawBody: body, timestamp: String(now), signature: 'v0=short', secret, nowSeconds: now }), false);
    assert.equal(verifySignature({ rawBody: body, timestamp: String(now - 301), signature: sign(now - 301, body), secret, nowSeconds: now }), false);
    assert.equal(verifySignature({ rawBody: body, timestamp: String(now + 301), signature: sign(now + 301, body), secret, nowSeconds: now }), false);
    assert.equal(verifySignature({ rawBody: body, timestamp: String(now - 299), signature: sign(now - 299, body), secret, nowSeconds: now }), true);
    assert.equal(verifySignature({ rawBody: body, timestamp: 'abc', signature: sign('abc', body), secret, nowSeconds: now }), false);
  });

  test('endpoint: bad signature and stale timestamp are rejected and nothing is sent', async () => {
    let res = await h.slackPost(staffReply(), { secret: 'wrong-secret' });
    assert.equal(res.status, 401);
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    res = await h.slackPost(staffReply(), { timestamp: stale });
    assert.equal(res.status, 401);
    assert.deepEqual(sent(), []);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_outbound_replies'), 0);
  });

  test('endpoint: url_verification answers the challenge', async () => {
    const res = await h.slackPost({ type: 'url_verification', challenge: 'fake-challenge-123' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { challenge: 'fake-challenge-123' });
  });

  test('endpoint: 503 when Slack is not configured', async () => {
    const saved = process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;
    try {
      const res = await h.slackPost(staffReply(), { secret: saved });
      assert.equal(res.status, 503);
    } finally {
      process.env.SLACK_SIGNING_SECRET = saved;
    }
  });
});

describe('staff reply -> text', () => {
  test('a staff thread reply is texted from the DJ number with prefix and suffix, then gets a check mark', async () => {
    const event = staffReply({ text: 'Use <https://wyxr.org/schedule|the schedule> &amp; ask <@UFAKEOTHER>' });
    const res = await h.slackPost(event);
    assert.equal(res.status, 200);
    assert.deepEqual(sent(), [{
      to: dj.phone_number,
      from: h.DJ_NUMBER,
      body: 'WYXR DJs:\nUse the schedule (https://wyxr.org/schedule) & ask\n\nReply STOP to opt out.'
    }]);
    assert.deepEqual(await replies(), [{ status: 'sent', error: null, has_sid: true }]);
    assert.deepEqual(slackCalls(), [{
      method: 'reactions.add',
      payload: { channel: 'CFAKECHAN', timestamp: event.event.ts, name: 'white_check_mark' }
    }]);
  });

  test('duplicate Slack retries text the DJ only once', async () => {
    const event = staffReply();
    await h.slackPost(event);
    await h.slackPost(event);
    await h.slackPost(event);
    assert.equal(sent().length, 1);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_outbound_replies'), 1);
  });

  test('a thread reply also sent to the channel (thread_broadcast) is texted', async () => {
    await h.slackPost(staffReply({ subtype: 'thread_broadcast', text: 'Thanks for taking the survey!' }));
    assert.deepEqual(sent(), [{
      to: dj.phone_number,
      from: h.DJ_NUMBER,
      body: 'WYXR DJs:\nThanks for taking the survey!\n\nReply STOP to opt out.'
    }]);
  });

  const ignoredCases = {
    'bot message (bot_id)': { bot_id: 'BFAKE' },
    'bot message (subtype)': { subtype: 'bot_message' },
    'edited message': { subtype: 'message_changed' },
    'deleted message': { subtype: 'message_deleted' },
    'channel join': { subtype: 'channel_join' },
    'top-level message (no thread_ts)': { thread_ts: undefined },
    'thread parent (thread_ts == ts)': { ts: THREAD },
    'other channel': { channel: 'COTHERCHAN' },
    'unknown thread': { thread_ts: '1600000000.000001' }
  };
  for (const [name, fields] of Object.entries(ignoredCases)) {
    test(`ignores ${name}`, async () => {
      const res = await h.slackPost(staffReply(fields));
      assert.equal(res.status, 200);
      assert.deepEqual(sent(), []);
      assert.deepEqual(slackCalls(), []);
      assert.equal(await h.count('SELECT COUNT(*) FROM dj_outbound_replies'), 0);
    });
  }

  const skipCases = [
    ['opted out', { opted_out: true }, /opted out/],
    ['not signed up', { opted_in: false }, /not signed up/],
    ['removed', { active: false }, /removed from the roster/]
  ];
  for (const [name, change, pattern] of skipCases) {
    test(`skips a reply to a DJ who is ${name}, and says why in the thread`, async () => {
      const sets = Object.keys(change).map((k, i) => `${k} = $${i + 2}`).join(', ');
      await h.pool.query(`UPDATE dj_roster SET ${sets} WHERE id = $1`, [dj.id, ...Object.values(change)]);
      await h.slackPost(staffReply());
      assert.deepEqual(sent(), []);
      const [row] = await replies();
      assert.equal(row.status, 'skipped');
      assert.match(row.error, pattern);
      const calls = slackCalls();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].payload.thread_ts, THREAD);
      assert.match(calls[0].payload.text, /Not sent/);
      assert.match(calls[0].payload.text, pattern);
    });
  }

  test('skips when the kill switch is off or the DJ number is unset (never the listener number)', async () => {
    await h.pool.query(`UPDATE settings SET value = 'false' WHERE key = 'messaging_enabled'`);
    await h.slackPost(staffReply());
    await h.pool.query(`UPDATE settings SET value = 'true' WHERE key = 'messaging_enabled'`);
    delete process.env.DJ_TWILIO_PHONE_NUMBER;
    await h.slackPost(staffReply());
    assert.deepEqual(sent(), []);
    const rows = await replies();
    assert.deepEqual(rows.map((r) => r.status), ['skipped', 'skipped']);
    assert.match(rows[0].error, /paused/);
    assert.match(rows[1].error, /DJ sending is off/);
  });

  test('a reply over 3 segments is not sent; staff are asked for a shorter one', async () => {
    await h.slackPost(staffReply({ text: 'x'.repeat(500) }));
    assert.deepEqual(sent(), []);
    const [row] = await replies();
    assert.equal(row.status, 'skipped');
    assert.match(slackCalls()[0].payload.text, /shorter message/);
  });

  test('Twilio 21610 marks the DJ opted out (roster only) and says so in the thread', async () => {
    await h.addListener(dj.phone_number);
    h.twilioService.dryRun.failures.set(dj.phone_number, 21610);
    await h.slackPost(staffReply());
    assert.equal((await h.getDj(dj.id)).opted_out, true);
    const contact = (await h.pool.query('SELECT opted_out FROM contacts WHERE phone_number = $1', [dj.phone_number])).rows[0];
    assert.equal(contact.opted_out, false);
    const [row] = await replies();
    assert.equal(row.status, 'failed');
    assert.match(slackCalls()[0].payload.text, /opted out/);
  });
});

describe('end to end: DJ reply -> Slack thread -> staff answer -> text', () => {
  test('the thread created by a DJ reply is the one staff answer in', async () => {
    const dj2 = await h.addDj({ phone_number: h.fake(120), first_name: 'Sam', last_name: 'Ortiz' });
    await h.djText(dj2.phone_number, 'Is Studio A fixed?');
    const post = h.slack.dryRun.calls[0];
    assert.equal(post.method, 'chat.postMessage');
    h.slack.dryRun.reset();

    await h.slackPost(staffReply({ thread_ts: post.ts, text: 'Yes, fixed this morning.' }));
    assert.deepEqual(sent(), [{
      to: dj2.phone_number,
      from: h.DJ_NUMBER,
      body: 'WYXR DJs:\nYes, fixed this morning.\n\nReply STOP to opt out.'
    }]);
  });

  test('re-adding a removed DJ by phone brings the same row back', async () => {
    const staff = h.client();
    await staff.login('staff');
    await h.pool.query('UPDATE dj_roster SET active = false WHERE id = $1', [dj.id]);
    const res = await staff.post('/admin/djs', { json: { phone: dj.phone_number, firstName: 'Ana', lastName: 'Lee-Park', showName: 'Night Moves' } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.data.id, dj.id);
    assert.equal(res.data.active, true);
    assert.equal(res.data.lastName, 'Lee-Park');
  });
});
