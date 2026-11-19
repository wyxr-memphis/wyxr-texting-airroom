const h = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const { parseName } = require('../services/djInbound');
const { MESSAGES } = require('../services/twilio');

const emitted = [];

before(async () => {
  await h.resetDb();
  await h.startApp();
  // Record every Socket.io broadcast so we can prove DJ texts never emit.
  const { io } = require('../app');
  const realEmit = io.emit.bind(io);
  io.emit = (event, ...args) => { emitted.push(event); return realEmit(event, ...args); };
});
after(h.stopApp);
beforeEach(async () => {
  await h.pool.query(`TRUNCATE dj_roster, dj_consent_log, dj_inbound_messages, dj_slack_threads, dj_outbound_replies, messages, contacts RESTART IDENTITY CASCADE`);
  h.twilioService.dryRun.reset();
  h.slack.dryRun.reset();
  emitted.length = 0;
  process.env.DJ_TWILIO_PHONE_NUMBER = h.DJ_NUMBER;
  process.env.SLACK_BOT_TOKEN = 'xoxb-fake-test-token';
});

const sent = () => h.twilioService.dryRun.outbox.map(({ to, from, body }) => ({ to, from, body }));
const actions = async (phone) =>
  (await h.pool.query('SELECT action_type FROM dj_consent_log WHERE phone_number = $1 ORDER BY id', [phone])).rows.map((r) => r.action_type);

// Assert the listener side was never touched.
async function assertListenerSideUntouched() {
  assert.equal(await h.count('SELECT COUNT(*) FROM messages'), 0, 'messages written');
  assert.equal(await h.count('SELECT COUNT(*) FROM contacts'), 0, 'contacts written');
  assert.equal(await h.count('SELECT COUNT(*) FROM opt_in_log'), 0, 'listener opt_in_log written');
  assert.ok(!emitted.includes('message:new'), 'message:new emitted');
}

describe('sign-up flow', () => {
  test('DJ -> request, YES -> confirmation and name ask, name -> thanks; all from the DJ number', async () => {
    const dj = await h.addDj({ phone_number: h.fake(110), first_name: null, last_name: null, opted_in: false, opt_in_method: null, opt_in_requested_at: null });

    let res = await h.djText(dj.phone_number, '  dj ');
    assert.equal(res.status, 200);
    assert.equal(res.text, '<Response></Response>');
    assert.ok((await h.getDj(dj.id)).opt_in_requested_at);

    await h.djText(dj.phone_number, 'Yes');
    let row = await h.getDj(dj.id);
    assert.equal(row.opted_in, true);
    assert.equal(row.opt_in_method, 'sms_keyword');
    assert.equal(row.name_request_count, 1);
    assert.ok(row.name_requested_at);

    await h.djText(dj.phone_number, '  Robin   Q.  Public ');
    row = await h.getDj(dj.id);
    assert.equal(row.first_name, 'Robin');
    assert.equal(row.last_name, 'Q. Public');
    assert.equal(row.name_requested_at, null);

    assert.deepEqual(sent(), [
      { to: dj.phone_number, from: h.DJ_NUMBER, body: MESSAGES.DJ_OPT_IN_REQUEST },
      { to: dj.phone_number, from: h.DJ_NUMBER, body: MESSAGES.DJ_OPT_IN_CONFIRMATION },
      { to: dj.phone_number, from: h.DJ_NUMBER, body: MESSAGES.DJ_NAME_REQUEST },
      { to: dj.phone_number, from: h.DJ_NUMBER, body: MESSAGES.DJ_NAME_THANKS }
    ]);
    assert.deepEqual(await actions(dj.phone_number), ['request', 'confirm', 'name_request', 'name_received']);
    // The name text is saved but never posted to Slack.
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_inbound_messages'), 1);
    assert.equal(h.slack.dryRun.calls.length, 0);
    await assertListenerSideUntouched();
  });

  test('YES with a name already on file: confirmation, no name ask', async () => {
    const dj = await h.addDj({ phone_number: h.fake(111), opted_in: false, opt_in_requested_at: null });
    await h.djText(dj.phone_number, 'DJ');
    await h.djText(dj.phone_number, 'y');
    assert.deepEqual(sent().map((s) => s.body), [MESSAGES.DJ_OPT_IN_REQUEST, MESSAGES.DJ_OPT_IN_CONFIRMATION]);
  });

  test('YES without a pending request is logged only', async () => {
    const dj = await h.addDj({ phone_number: h.fake(112), opted_in: false, opt_in_requested_at: null });
    await h.djText(dj.phone_number, 'YES');
    assert.equal((await h.getDj(dj.id)).opted_in, false);
    assert.deepEqual(sent(), []);
    assert.deepEqual(await actions(dj.phone_number), ['yes_without_request']);
  });

  test('YES from a number not on the roster does nothing', async () => {
    await h.djText(h.fake(113), 'yes');
    assert.deepEqual(sent(), []);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_roster'), 0);
    await assertListenerSideUntouched();
  });

  test('the listener YES words (ok, sure, confirm) are not DJ sign-ups', async () => {
    const dj = await h.addDj({ phone_number: h.fake(114), opted_in: false });
    await h.djText(dj.phone_number, 'ok');
    assert.equal((await h.getDj(dj.id)).opted_in, false);
  });

  test('DJ from an already signed-up DJ resends the confirmation, then asks for a missing name', async () => {
    const dj = await h.addDj({ phone_number: h.fake(115), first_name: 'Solo', last_name: null });
    await h.djText(dj.phone_number, 'DJ');
    assert.deepEqual(sent().map((s) => s.body), [MESSAGES.DJ_OPT_IN_CONFIRMATION, MESSAGES.DJ_NAME_REQUEST]);
  });

  test('DJ from an opted-out roster number is logged only', async () => {
    const dj = await h.addDj({ phone_number: h.fake(116), opted_out: true, opted_in: false });
    await h.djText(dj.phone_number, 'dj');
    assert.deepEqual(sent(), []);
    assert.deepEqual(await actions(dj.phone_number), ['join_while_opted_out']);
  });

  test('DJ from a number not on the roster: one reply per 24 hours, never added', async () => {
    const stranger = h.fake(117);
    await h.djText(stranger, 'DJ');
    await h.djText(stranger, 'dj');
    assert.deepEqual(sent(), [{ to: stranger, from: h.DJ_NUMBER, body: MESSAGES.DJ_NOT_ON_ROSTER }]);
    assert.deepEqual(await actions(stranger), ['not_on_roster_reply', 'not_on_roster']);
    await h.pool.query(`UPDATE dj_consent_log SET timestamp = NOW() - INTERVAL '25 hours'`);
    await h.djText(stranger, 'DJ');
    assert.equal(sent().length, 2);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_roster'), 0);
    await assertListenerSideUntouched();
  });

  test('DJ from a removed roster number gets the not-on-roster reply, not a sign-up', async () => {
    const dj = await h.addDj({ phone_number: h.fake(118), active: false, opted_in: false, opt_in_requested_at: null });
    await h.djText(dj.phone_number, 'DJ');
    assert.deepEqual(sent().map((s) => s.body), [MESSAGES.DJ_NOT_ON_ROSTER]);
    assert.equal((await h.getDj(dj.id)).opt_in_requested_at, null);
  });
});

describe('STOP, START, HELP', () => {
  test('STOP words opt out and send nothing; START/UNSTOP clear opt-out but keep opted_in as it was', async () => {
    for (const word of ['STOP', 'stopall', 'Unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke']) {
      const dj = await h.addDj({ phone_number: h.fake(120 + word.length), opted_in: true });
      await h.djText(dj.phone_number, ` ${word} `);
      assert.equal((await h.getDj(dj.id)).opted_out, true, word);
      await h.pool.query('DELETE FROM dj_roster WHERE id = $1', [dj.id]);
    }
    assert.deepEqual(sent(), []);

    const signedUp = await h.addDj({ phone_number: h.fake(140), opted_in: true, opted_out: true });
    const neverSigned = await h.addDj({ phone_number: h.fake(141), opted_in: false, opted_out: true });
    await h.djText(signedUp.phone_number, 'START');
    await h.djText(neverSigned.phone_number, 'unstop');
    assert.deepEqual(
      [await h.getDj(signedUp.id), await h.getDj(neverSigned.id)].map((d) => [d.opted_out, d.opted_in]),
      [[false, true], [false, false]]
    );
    assert.deepEqual(sent(), []);
  });

  test('STOP from an unknown number is logged, nothing created', async () => {
    await h.djText(h.fake(142), 'stop');
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_roster'), 0);
    assert.deepEqual(await actions(h.fake(142)), ['opt_out']);
    await assertListenerSideUntouched();
  });

  test('HELP is logged only', async () => {
    const dj = await h.addDj({ phone_number: h.fake(143) });
    await h.djText(dj.phone_number, 'help');
    assert.deepEqual(sent(), []);
    assert.deepEqual(await actions(dj.phone_number), ['help_request']);
  });
});

describe('name capture', () => {
  test('parseName', () => {
    assert.deepEqual(parseName('Ana Lee'), { firstName: 'Ana', lastName: 'Lee' });
    assert.deepEqual(parseName('  Mary   Ann  van der Berg '), { firstName: 'Mary', lastName: 'Ann van der Berg' });
    assert.equal(parseName('Prince'), null);
    assert.equal(parseName('   '), null);
    assert.equal(parseName(`${'a'.repeat(101)} Lee`), null);
    assert.equal(parseName(`Ana ${'b'.repeat(101)}`), null);
    assert.deepEqual(parseName(`${'a'.repeat(100)} ${'b'.repeat(100)}`), { firstName: 'a'.repeat(100), lastName: 'b'.repeat(100) });
  });

  test('one word asks again, at most 3 asks in total, then texts go to Slack', async () => {
    const dj = await h.addDj({ phone_number: h.fake(150), first_name: null, last_name: null, opted_in: false, opt_in_requested_at: new Date() });
    await h.djText(dj.phone_number, 'YES');          // ask #1
    await h.djText(dj.phone_number, 'Prince');       // ask #2
    await h.djText(dj.phone_number, 'Cher');         // ask #3
    await h.djText(dj.phone_number, 'Madonna');      // limit reached: no 4th ask
    let row = await h.getDj(dj.id);
    assert.equal(row.name_request_count, 3);
    assert.equal(row.name_requested_at, null);
    assert.equal(row.first_name, null);
    assert.equal(sent().filter((s) => s.body === MESSAGES.DJ_NAME_REQUEST).length, 3);
    assert.equal(h.slack.dryRun.calls.length, 0);

    // After the limit, an ordinary text is a reply and goes to Slack.
    await h.djText(dj.phone_number, 'Running late tonight');
    assert.equal(h.slack.dryRun.calls.length, 1);
    assert.match(h.slack.dryRun.calls[0].payload.text, /Name not on file/);

    // DJ again does not start a fourth ask.
    await h.djText(dj.phone_number, 'DJ');
    row = await h.getDj(dj.id);
    assert.equal(row.name_request_count, 3);
  });

  test('saving both names on /admin/djs clears name_requested_at', async () => {
    const dj = await h.addDj({ phone_number: h.fake(151), first_name: null, last_name: null, name_requested_at: new Date(), name_request_count: 1 });
    const staff = h.client();
    await staff.login('staff');
    const res = await staff.patch(`/admin/djs/${dj.id}`, { json: { phone: dj.phone_number, firstName: ' Ana ', lastName: 'Lee ', showName: 'Night Moves' } });
    assert.equal(res.status, 200, res.text);
    const row = await h.getDj(dj.id);
    assert.deepEqual([row.first_name, row.last_name, row.show_name, row.name_requested_at], ['Ana', 'Lee', 'Night Moves', null]);

    // One name without the other is rejected; names over 100 characters too.
    let bad = await staff.patch(`/admin/djs/${dj.id}`, { json: { phone: dj.phone_number, firstName: 'Ana', lastName: '' } });
    assert.equal(bad.status, 400);
    bad = await staff.post('/admin/djs', { json: { phone: '901-555-0152', firstName: 'a'.repeat(101), lastName: 'b' } });
    assert.equal(bad.status, 400);
    bad = await staff.post('/admin/djs', { json: { phone: 'not a phone' } });
    assert.equal(bad.status, 400);
    // Blank names on add are allowed (the app asks by text later).
    const ok = await staff.post('/admin/djs', { json: { phone: '(901) 555-0153' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.phone, '+19015550153');
    assert.equal(ok.data.needsName, true);
    const dup = await staff.post('/admin/djs', { json: { phone: '901-555-0153' } });
    assert.equal(dup.status, 409);
    // Remove never deletes.
    const removed = await staff.post(`/admin/djs/${ok.data.id}/remove`, { json: {} });
    assert.equal(removed.data.active, false);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_roster WHERE id = $1', [ok.data.id]), 1);
  });
});

describe('replies to Slack', () => {
  test('a reply is saved, posted after the response, and threads per DJ', async () => {
    const dj = await h.addDj({ phone_number: h.fake(160), first_name: 'Ana', last_name: 'Lee', show_name: 'Night <Moves> & Co' });
    await h.djText(dj.phone_number, 'Can I swap to <Studio B>?');
    await h.djText(dj.phone_number, 'Second message');

    const calls = h.slack.dryRun.calls;
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'chat.postMessage');
    assert.equal(calls[0].payload.channel, 'CFAKECHAN');
    assert.equal(calls[0].payload.thread_ts, undefined);
    assert.equal(calls[0].payload.text, '*Ana Lee* (Night &lt;Moves&gt; &amp; Co)\nCan I swap to &lt;Studio B&gt;?');
    assert.equal(calls[1].payload.thread_ts, calls[0].ts);

    const { rows } = await h.pool.query('SELECT slack_ts, slack_thread_ts FROM dj_inbound_messages ORDER BY id');
    assert.deepEqual(rows, [
      { slack_ts: calls[0].ts, slack_thread_ts: calls[0].ts },
      { slack_ts: calls[1].ts, slack_thread_ts: calls[0].ts }
    ]);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_slack_threads'), 1);
    assert.deepEqual(sent(), []);
    await assertListenerSideUntouched();
  });

  test('a thread idle longer than DJ_SLACK_THREAD_DAYS starts a new one', async () => {
    const dj = await h.addDj({ phone_number: h.fake(161) });
    await h.djText(dj.phone_number, 'first');
    await h.pool.query(`UPDATE dj_slack_threads SET last_message_at = NOW() - INTERVAL '8 days'`);
    await h.djText(dj.phone_number, 'much later');
    assert.equal(h.slack.dryRun.calls[1].payload.thread_ts, undefined);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_slack_threads'), 2);
  });

  test('Slack off: reply still saved, nothing posted; Slack failure never fails the webhook', async () => {
    const dj = await h.addDj({ phone_number: h.fake(162) });
    delete process.env.SLACK_BOT_TOKEN;
    let res = await h.djText(dj.phone_number, 'saved without slack');
    assert.equal(res.status, 200);
    assert.equal(h.slack.dryRun.calls.length, 0);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_inbound_messages'), 1);
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake-test-token';

    const staff = h.client();
    delete process.env.SLACK_BOT_TOKEN;
    await staff.login('staff');
    const page = await staff.get('/admin/djs');
    assert.match(page.text, /Slack is off/);
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake-test-token';

    // Make the Slack call throw: with dry run off, NODE_ENV=test makes the
    // service refuse the real API (so this never reaches Slack either).
    process.env.SLACK_DRY_RUN = 'false';
    try {
      res = await h.djText(dj.phone_number, 'slack is down');
    } finally {
      process.env.SLACK_DRY_RUN = 'true';
    }
    assert.equal(res.status, 200);
    assert.equal(res.text, '<Response></Response>');
    const { rows } = await h.pool.query('SELECT body, slack_ts FROM dj_inbound_messages ORDER BY id');
    assert.deepEqual(rows[1], { body: 'slack is down', slack_ts: null });
  });

  test('anything from a non-roster number is logged with no reply and nothing saved', async () => {
    await h.djText(h.fake(163), 'who is this');
    assert.deepEqual(sent(), []);
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_inbound_messages'), 0);
    assert.deepEqual(await actions(h.fake(163)), ['unknown_sender']);
    await assertListenerSideUntouched();
  });

  test('malformed From is rejected with empty TwiML', async () => {
    const res = await h.twilioPost('/webhook/dj-sms', { From: 'not-a-number', Body: 'hi' });
    assert.equal(res.text, '<Response></Response>');
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_consent_log'), 0);
  });

  test('no DJ number: nothing is sent and the listener number is never used', async () => {
    const dj = await h.addDj({ phone_number: h.fake(164), opted_in: false, opt_in_requested_at: null });
    delete process.env.DJ_TWILIO_PHONE_NUMBER;
    await h.djText(dj.phone_number, 'DJ');
    assert.deepEqual(sent(), []);
  });
});

describe('Twilio signature in production', () => {
  const url = 'https://example.invalid/webhook/dj-sms';
  const withProd = async (fn) => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try { return await fn(); } finally { process.env.NODE_ENV = saved; }
  };

  test('rejects every request if DJ_TWILIO_WEBHOOK_URL is unset', async () => {
    delete process.env.DJ_TWILIO_WEBHOOK_URL;
    const dj = await h.addDj({ phone_number: h.fake(170), opted_in: false });
    const res = await withProd(() => h.djText(dj.phone_number, 'DJ'));
    assert.equal(res.status, 403);
    assert.deepEqual(sent(), []);
  });

  test('accepts a valid signature over DJ_TWILIO_WEBHOOK_URL and rejects a bad one', async () => {
    process.env.DJ_TWILIO_WEBHOOK_URL = url;
    const dj = await h.addDj({ phone_number: h.fake(171), opted_in: false });
    const params = { From: dj.phone_number, Body: 'DJ', To: h.DJ_NUMBER };
    const good = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
    try {
      let res = await withProd(() => h.twilioPost('/webhook/dj-sms', params, { 'X-Twilio-Signature': 'bad' }));
      assert.equal(res.status, 403);
      res = await withProd(() => h.twilioPost('/webhook/dj-sms', params, { 'X-Twilio-Signature': good }));
      assert.equal(res.status, 200);
      assert.deepEqual(sent().map((s) => s.body), [MESSAGES.DJ_OPT_IN_REQUEST]);
    } finally {
      delete process.env.DJ_TWILIO_WEBHOOK_URL;
    }
  });
});
