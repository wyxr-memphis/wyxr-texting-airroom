const h = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getRecipientCounts, snapshotRecipients } = require('../services/broadcastAudience');
const worker = require('../services/broadcastWorker');
const { fullTextFor } = require('../utils/smsText');

let staff;

before(async () => {
  await h.resetDb();
  await h.startApp();
  // Log in once: the login rate limiter allows 10 attempts per 15 minutes.
  staff = h.client();
  await staff.login('staff');
});
after(h.stopApp);
beforeEach(async () => {
  await h.pool.query(`TRUNCATE dj_roster, contacts, broadcasts, broadcast_recipients, blocked_numbers RESTART IDENTITY CASCADE`);
  await h.pool.query(`UPDATE settings SET value = 'true' WHERE key = 'messaging_enabled'`);
  h.twilioService.dryRun.reset();
  process.env.DJ_TWILIO_PHONE_NUMBER = h.DJ_NUMBER;
});

// Run the worker until no broadcast is sending (bounded).
async function runWorker(max = 50) {
  for (let i = 0; i < max; i++) {
    const { rows } = await h.pool.query("SELECT 1 FROM broadcasts WHERE status = 'sending'");
    if (rows.length === 0) return;
    await worker.tick();
  }
}

async function djDraft(body = 'Studio A board is down Thursday 2-4pm.') {
  const res = await staff.post('/admin/djs/broadcasts', { json: { body } });
  assert.equal(res.status, 200, res.text);
  return res.data.id;
}

describe('DJ audience rule', () => {
  test('only active, signed-up, not-opted-out DJs with both names are counted and snapshotted', async () => {
    const ok = await h.addDj({ phone_number: h.fake(110) });
    await h.addDj({ phone_number: h.fake(111), first_name: null });                 // no first name
    await h.addDj({ phone_number: h.fake(112), last_name: '   ' });                 // whitespace last name
    await h.addDj({ phone_number: h.fake(113), first_name: '', last_name: '' });    // no names
    await h.addDj({ phone_number: h.fake(114), opted_in: false });                  // not signed up
    await h.addDj({ phone_number: h.fake(115), opted_out: true });                  // STOP
    await h.addDj({ phone_number: h.fake(116), active: false });                    // removed
    await h.addListener(h.fake(117));                                               // a listener, not a DJ

    const counts = await getRecipientCounts('djs');
    assert.equal(counts.count, 1);
    assert.equal(counts.missingName, 3);

    const { rows: [b] } = await h.pool.query("INSERT INTO broadcasts (body, audience) VALUES ('x', 'djs') RETURNING id");
    const client = await h.pool.connect();
    try {
      assert.equal(await snapshotRecipients(client, b.id, 'djs'), 1);
    } finally {
      client.release();
    }
    const { rows } = await h.pool.query('SELECT phone_number, opt_in_method FROM broadcast_recipients');
    assert.deepEqual(rows, [{ phone_number: ok.phone_number, opt_in_method: 'sms_keyword' }]);
  });

  test('listener rule is unchanged and never includes DJs', async () => {
    await h.addListener(h.fake(120), { opt_in_method: 'sms' });
    await h.addListener(h.fake(121), { opt_in_method: 'web' });
    await h.addListener(h.fake(122), { opt_in_method: 'legacy' });
    await h.addListener(h.fake(123), { opt_in_method: 'import' });
    await h.addListener(h.fake(124), { opted_out: true });
    await h.addDj({ phone_number: h.fake(125) });
    const counts = await getRecipientCounts();
    assert.deepEqual(counts, {
      count: 3, byMethod: { sms: 1, web: 1, legacy: 1 }, excludedImported: 1, awaitingReconsent: 0
    });
    assert.deepEqual(await getRecipientCounts('listeners'), counts);
  });

  test('an unknown audience is rejected', async () => {
    await assert.rejects(() => getRecipientCounts('everyone'), /Unknown broadcast audience/);
  });
});

describe('DJ broadcast end to end (dry run)', () => {
  test('compose -> test send -> confirm -> worker -> status, all from the DJ number with the DJ prefix', async () => {
    await h.addDj({ phone_number: h.fake(130) });
    await h.addDj({ phone_number: h.fake(131), first_name: 'Ana', last_name: 'Lee' });
    await h.addDj({ phone_number: h.fake(132), first_name: null, last_name: null }); // left out: no name
    await h.addListener(h.fake(133));

    const id = await djDraft();
    const expected = 'WYXR DJs: Studio A board is down Thursday 2-4pm. Reply STOP to opt out.';

    let res = await staff.post(`/admin/broadcasts/${id}/test-send`, { json: { phone: '901-555-0199' } });
    assert.equal(res.status, 200);
    assert.deepEqual(
      h.twilioService.dryRun.outbox.map(({ to, from, body }) => ({ to, from, body })),
      [{ to: '+19015550199', from: h.DJ_NUMBER, body: expected }]
    );

    res = await staff.post(`/admin/broadcasts/${id}/confirm`, { json: { confirmedRecipientCount: 2 } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.data.recipientCount, 2);
    const { rows: [b] } = await h.pool.query('SELECT * FROM broadcasts WHERE id = $1', [id]);
    assert.equal(b.from_number, h.DJ_NUMBER);
    assert.equal(b.audience, 'djs');

    await runWorker();
    const sends = h.twilioService.dryRun.outbox.slice(1);
    assert.equal(sends.length, 2);
    for (const s of sends) {
      assert.equal(s.from, h.DJ_NUMBER);
      assert.equal(s.body, expected);
    }
    assert.deepEqual(sends.map((s) => s.to).sort(), [h.fake(130), h.fake(131)]);

    res = await staff.get(`/admin/broadcasts/${id}/status`);
    assert.equal(res.data.status, 'completed');
    assert.equal(res.data.sentCount, 2);
    res = await staff.get(`/admin/broadcasts/${id}`);
    assert.match(res.text, /DJs only\. Not sent to listeners\./);
  });

  test('the segment count includes the DJ prefix and STOP suffix', async () => {
    const id = await djDraft('x'.repeat(120)); // 120 + 10 prefix + 23 suffix = 153 -> 1 segment
    let { rows: [b] } = await h.pool.query('SELECT character_count, segment_count FROM broadcasts WHERE id = $1', [id]);
    assert.equal(b.character_count, 120 + 'WYXR DJs: '.length + ' Reply STOP to opt out.'.length);
    const id2 = await djDraft('x'.repeat(130)); // 163 -> 2 segments
    ({ rows: [b] } = await h.pool.query('SELECT segment_count FROM broadcasts WHERE id = $1', [id2]));
    assert.equal(b.segment_count, 2);
  });
});

describe('DJ sending is off without DJ_TWILIO_PHONE_NUMBER', () => {
  test('test-send and confirm return 409 and never fall back to the listener number', async () => {
    await h.addDj({ phone_number: h.fake(140) });
    const id = await djDraft();
    delete process.env.DJ_TWILIO_PHONE_NUMBER;

    let res = await staff.post(`/admin/broadcasts/${id}/test-send`, { json: { phone: '901-555-0198' } });
    assert.equal(res.status, 409);
    res = await staff.post(`/admin/broadcasts/${id}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 409);
    assert.equal(h.twilioService.dryRun.outbox.length, 0);
    const { rows: [b] } = await h.pool.query('SELECT status FROM broadcasts WHERE id = $1', [id]);
    assert.equal(b.status, 'draft');

    res = await staff.get('/admin/djs');
    assert.match(res.text, /DJ sending is off/);
    res = await staff.get('/admin/djs/message');
    assert.match(res.text, /DJ sending is off/);
  });

  test('worker never sends a DJ broadcast that has no from_number', async () => {
    await h.addDj({ phone_number: h.fake(141) });
    const { rows: [b] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, confirmed_at, recipient_count)
       VALUES ('hi', 'djs', 'sending', NOW(), NOW(), 1) RETURNING id`
    );
    await h.pool.query(`INSERT INTO broadcast_recipients (broadcast_id, phone_number) VALUES ($1, $2)`, [b.id, h.fake(141)]);
    await runWorker();
    assert.equal(h.twilioService.dryRun.outbox.length, 0);
    const { rows: [r] } = await h.pool.query('SELECT status, error_code FROM broadcast_recipients');
    assert.deepEqual(r, { status: 'failed_permanent', error_code: 'no_from_number' });
  });
});

describe('per-audience in-flight check and cooldown', () => {
  test('a sending listener broadcast does not block a DJ broadcast, but a sending DJ one does', async () => {
    await h.addDj({ phone_number: h.fake(150) });
    await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, confirmed_at, from_number)
       VALUES ('listener send', 'listeners', 'sending', NOW(), NOW(), $1)`,
      [h.LISTENER_NUMBER]
    );
    const id = await djDraft();
    let res = await staff.post(`/admin/broadcasts/${id}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 200, res.text); // listener send in flight and within 30 min: still allowed

    // Wipe the DJ cooldown window so only the in-flight rule applies.
    await h.pool.query(`UPDATE broadcasts SET confirmed_at = NOW() - INTERVAL '1 hour' WHERE audience = 'djs'`);
    const id2 = await djDraft('second');
    res = await staff.post(`/admin/broadcasts/${id2}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /currently sending/);
  });

  test('DJ cooldown is 2 minutes and counts only DJ broadcasts', async () => {
    await h.addDj({ phone_number: h.fake(151) });
    // A listener broadcast confirmed 1 minute ago does not start the DJ cooldown.
    await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, confirmed_at) VALUES ('l', 'listeners', 'completed', NOW() - INTERVAL '1 minute')`
    );
    const id = await djDraft();
    let res = await staff.post(`/admin/broadcasts/${id}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 200, res.text);
    await runWorker();

    const id2 = await djDraft('again');
    res = await staff.post(`/admin/broadcasts/${id2}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 429);
    assert.match(res.data.error, /2-minute cooldown/);

    await h.pool.query(`UPDATE broadcasts SET confirmed_at = NOW() - INTERVAL '3 minutes' WHERE id = $1`, [id]);
    res = await staff.post(`/admin/broadcasts/${id2}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 200, res.text);
  });

  test('listener cooldown is unchanged (30 min) and ignores DJ broadcasts', async () => {
    await h.addListener(h.fake(152));
    await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, confirmed_at) VALUES ('d', 'djs', 'completed', NOW() - INTERVAL '1 minute')`
    );
    const shared = h.client();
    await shared.login('dj');
    let res = await shared.post('/admin/broadcasts', { json: { body: 'Listener news' } });
    const id = res.data.id;
    res = await shared.post(`/admin/broadcasts/${id}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 200, res.text);
    const { rows: [b] } = await h.pool.query('SELECT from_number FROM broadcasts WHERE id = $1', [id]);
    assert.equal(b.from_number, h.LISTENER_NUMBER);
    await h.pool.query(`UPDATE broadcasts SET status = 'completed' WHERE id = $1`, [id]);

    res = await shared.post('/admin/broadcasts', { json: { body: 'Listener news 2' } });
    res = await shared.post(`/admin/broadcasts/${res.data.id}/confirm`, { json: { confirmedRecipientCount: 1 } });
    assert.equal(res.status, 429);
    assert.match(res.data.error, /30-minute cooldown/);
  });

  test('the database allows one sending broadcast per audience', async () => {
    await h.pool.query(`INSERT INTO broadcasts (body, audience, status) VALUES ('a', 'listeners', 'sending'), ('b', 'djs', 'sending')`);
    await assert.rejects(
      () => h.pool.query(`INSERT INTO broadcasts (body, audience, status) VALUES ('c', 'djs', 'sending')`),
      /idx_broadcasts_one_active/
    );
  });
});

describe('worker', () => {
  test('sends the oldest sending broadcast first, each from its own number', async () => {
    const { rows: [l] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number)
       VALUES ('listener', 'listeners', 'sending', NOW() - INTERVAL '5 minutes', $1) RETURNING id`, [h.LISTENER_NUMBER]
    );
    const { rows: [d] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number)
       VALUES ('dj', 'djs', 'sending', NOW(), $1) RETURNING id`, [h.DJ_NUMBER]
    );
    await h.pool.query(
      `INSERT INTO broadcast_recipients (broadcast_id, phone_number) VALUES ($1, $3), ($1, $4), ($2, $5)`,
      [l.id, d.id, h.fake(160), h.fake(161), h.fake(162)]
    );
    await runWorker();
    const sends = h.twilioService.dryRun.outbox.map(({ to, from, body }) => ({ to, from, body }));
    assert.deepEqual(sends, [
      { to: h.fake(160), from: h.LISTENER_NUMBER, body: 'listener Reply STOP to opt out.' },
      { to: h.fake(161), from: h.LISTENER_NUMBER, body: 'listener Reply STOP to opt out.' },
      { to: h.fake(162), from: h.DJ_NUMBER, body: 'WYXR DJs: dj Reply STOP to opt out.' }
    ]);
  });

  test('a pre-007 listener broadcast with no from_number still sends from TWILIO_PHONE_NUMBER', async () => {
    const { rows: [l] } = await h.pool.query(
      `INSERT INTO broadcasts (body, status, started_at) VALUES ('old', 'sending', NOW()) RETURNING id`
    );
    await h.pool.query(`INSERT INTO broadcast_recipients (broadcast_id, phone_number) VALUES ($1, $2)`, [l.id, h.fake(163)]);
    await runWorker();
    assert.equal(h.twilioService.dryRun.outbox[0].from, h.LISTENER_NUMBER);
  });

  test('21610 on a DJ broadcast updates dj_roster only; on a listener broadcast, contacts only', async () => {
    const phone = h.fake(170); // same person is both a DJ and a listener
    await h.addDj({ phone_number: phone });
    await h.addListener(phone);
    h.twilioService.dryRun.failures.set(phone, 21610);

    const { rows: [d] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number) VALUES ('d', 'djs', 'sending', NOW(), $1) RETURNING id`,
      [h.DJ_NUMBER]
    );
    await h.pool.query(`INSERT INTO broadcast_recipients (broadcast_id, phone_number) VALUES ($1, $2)`, [d.id, phone]);
    await runWorker();
    let dj = (await h.pool.query('SELECT opted_out FROM dj_roster WHERE phone_number = $1', [phone])).rows[0];
    let contact = (await h.pool.query('SELECT opted_out FROM contacts WHERE phone_number = $1', [phone])).rows[0];
    assert.equal(dj.opted_out, true);
    assert.equal(contact.opted_out, false);

    await h.pool.query('UPDATE dj_roster SET opted_out = false');
    const { rows: [l] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number) VALUES ('l', 'listeners', 'sending', NOW(), $1) RETURNING id`,
      [h.LISTENER_NUMBER]
    );
    await h.pool.query(`INSERT INTO broadcast_recipients (broadcast_id, phone_number) VALUES ($1, $2)`, [l.id, phone]);
    await runWorker();
    dj = (await h.pool.query('SELECT opted_out FROM dj_roster WHERE phone_number = $1', [phone])).rows[0];
    contact = (await h.pool.query('SELECT opted_out FROM contacts WHERE phone_number = $1', [phone])).rows[0];
    assert.equal(dj.opted_out, false);
    assert.equal(contact.opted_out, true);
  });

  test('the messaging_enabled kill switch pauses DJ broadcasts too', async () => {
    const { rows: [d] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number) VALUES ('d', 'djs', 'sending', NOW(), $1) RETURNING id`,
      [h.DJ_NUMBER]
    );
    await h.pool.query(`INSERT INTO broadcast_recipients (broadcast_id, phone_number) VALUES ($1, $2)`, [d.id, h.fake(171)]);
    await h.pool.query(`UPDATE settings SET value = 'false' WHERE key = 'messaging_enabled'`);
    await worker.tick();
    await worker.tick();
    assert.equal(h.twilioService.dryRun.outbox.length, 0);
    await h.pool.query(`UPDATE settings SET value = 'true' WHERE key = 'messaging_enabled'`);
    await runWorker();
    assert.equal(h.twilioService.dryRun.outbox.length, 1);
  });

  test('crash recovery checks Twilio using each broadcast\'s from_number and DJ text', async () => {
    const { rows: [d] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number) VALUES ('notice', 'djs', 'sending', NOW() - INTERVAL '10 minutes', $1) RETURNING id`,
      [h.DJ_NUMBER]
    );
    const { rows: [l] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at, from_number) VALUES ('news', 'listeners', 'completed', NOW() - INTERVAL '10 minutes', $1) RETURNING id`,
      [h.LISTENER_NUMBER]
    );
    await h.pool.query(
      `INSERT INTO broadcast_recipients (broadcast_id, phone_number, status, claimed_at)
       VALUES ($1, $3, 'sending', NOW() - INTERVAL '5 minutes'), ($2, $4, 'sending', NOW() - INTERVAL '5 minutes')`,
      [d.id, l.id, h.fake(180), h.fake(181)]
    );
    // Simulate Twilio having already delivered the DJ text.
    const original = h.twilioService.listMessagesTo;
    const calls = [];
    h.twilioService.listMessagesTo = async (to, after, limit, opts) => {
      calls.push({ to, from: opts && opts.from });
      return to === h.fake(180)
        ? [{ sid: 'SMalready', body: fullTextFor('notice', 'djs'), dateSent: new Date() }]
        : [];
    };
    try {
      await worker.resumeInterruptedBroadcasts();
    } finally {
      h.twilioService.listMessagesTo = original;
    }
    assert.deepEqual(calls.sort((a, b) => a.to.localeCompare(b.to)), [
      { to: h.fake(180), from: h.DJ_NUMBER },
      { to: h.fake(181), from: h.LISTENER_NUMBER }
    ]);
    const { rows } = await h.pool.query('SELECT phone_number, status, twilio_sid FROM broadcast_recipients ORDER BY phone_number');
    assert.deepEqual(rows, [
      { phone_number: h.fake(180), status: 'sent', twilio_sid: 'SMalready' },
      { phone_number: h.fake(181), status: 'skipped', twilio_sid: null }
    ]);
    assert.equal(h.twilioService.dryRun.outbox.length, 0);
  });

  test('crash recovery leaves a DJ row claimed (never guesses) if its broadcast has no from_number', async () => {
    const { rows: [d] } = await h.pool.query(
      `INSERT INTO broadcasts (body, audience, status, started_at) VALUES ('x', 'djs', 'sending', NOW()) RETURNING id`
    );
    await h.pool.query(
      `INSERT INTO broadcast_recipients (broadcast_id, phone_number, status, claimed_at) VALUES ($1, $2, 'sending', NOW() - INTERVAL '5 minutes')`,
      [d.id, h.fake(182)]
    );
    await worker.resumeInterruptedBroadcasts();
    assert.equal(h.twilioService.dryRun.listCalls.length, 0);
    const { rows: [r] } = await h.pool.query('SELECT status FROM broadcast_recipients');
    assert.equal(r.status, 'sending');
  });
});
