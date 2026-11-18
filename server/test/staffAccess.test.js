const h = require('./helpers');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const { verifyCredentials, assertCredentialConfig } = require('../utils/credentials');

before(async () => {
  await h.resetDb();
  await h.startApp();
});
after(h.stopApp);
beforeEach(async () => {
  await h.pool.query('TRUNCATE dj_roster, dj_inbound_messages, dj_outbound_replies, dj_slack_threads, broadcasts, broadcast_recipients RESTART IDENTITY CASCADE');
  h.twilioService.dryRun.reset();
});

describe('credentials', () => {
  test('staff is checked first, shared login is dj, anything else is null', () => {
    assert.equal(verifyCredentials('staff-user', 'staff-password'), 'staff');
    assert.equal(verifyCredentials('shared-dj', 'shared-dj-password'), 'dj');
    assert.equal(verifyCredentials('staff-user', 'shared-dj-password'), null);
    assert.equal(verifyCredentials('', ''), null);
  });

  test('with STAFF_* unset no staff login is possible', () => {
    const saved = { u: process.env.STAFF_USERNAME, p: process.env.STAFF_PASSWORD };
    delete process.env.STAFF_USERNAME;
    delete process.env.STAFF_PASSWORD;
    try {
      assert.equal(verifyCredentials('staff-user', 'staff-password'), null);
      assert.equal(verifyCredentials('', ''), null);
      assert.equal(verifyCredentials('shared-dj', 'shared-dj-password'), 'dj');
    } finally {
      process.env.STAFF_USERNAME = saved.u;
      process.env.STAFF_PASSWORD = saved.p;
    }
  });

  test('refuses to start if STAFF_USERNAME equals AUTH_USERNAME', () => {
    const saved = process.env.STAFF_USERNAME;
    process.env.STAFF_USERNAME = process.env.AUTH_USERNAME;
    try {
      assert.throws(() => assertCredentialConfig(), /must be different/);
    } finally {
      process.env.STAFF_USERNAME = saved;
    }
    assert.doesNotThrow(() => assertCredentialConfig());
  });
});

describe('login sets the session role', () => {
  test('/admin/login: staff goes to /admin/djs, shared login cannot open it', async () => {
    const staff = h.client();
    let res = await staff.post('/admin/login', { form: { username: 'staff-user', password: 'staff-password' }, origin: false });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin/djs');
    res = await staff.get('/admin/djs');
    assert.equal(res.status, 200);

    const dj = h.client();
    res = await dj.post('/admin/login', { form: { username: 'shared-dj', password: 'shared-dj-password' }, origin: false });
    assert.equal(res.headers.get('location'), '/admin/messages');
    res = await dj.get('/admin/djs');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin/login?staff=1');
    // The login form renders for a signed-in DJ asking for staff (no redirect loop).
    res = await dj.get('/admin/login?staff=1');
    assert.equal(res.status, 200);
    assert.match(res.text, /needs the staff login/);
  });

  test('a session with no role counts as dj', async () => {
    const c = h.client();
    await c.login('staff');
    // Strip the role from the stored session, as for sessions created before this change.
    await h.pool.query(`UPDATE session SET sess = (sess::jsonb - 'role')::json`);
    const res = await c.get('/admin/djs/recipient-count');
    assert.equal(res.status, 403);
  });
});

describe('every DJ route requires staff', () => {
  const jsonRoutes = [
    ['post', '/admin/djs', { phone: '901-555-0150' }],
    ['patch', '/admin/djs/1', { phone: '901-555-0150' }],
    ['post', '/admin/djs/1/remove', {}],
    ['post', '/admin/djs/messages/1/read', { read: true }],
    ['get', '/admin/djs/recipient-count'],
    ['post', '/admin/djs/broadcasts', { body: 'hello' }]
  ];
  const htmlRoutes = ['/admin/djs', '/admin/djs/message'];

  test('anonymous: 401 JSON / redirect to login', async () => {
    const anon = h.client();
    for (const [method, path, json] of jsonRoutes) {
      const res = await anon[method](path, { json });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
    for (const path of htmlRoutes) {
      const res = await anon.get(path);
      assert.equal(res.status, 302, path);
    }
  });

  test('shared DJ login: 403 JSON / redirect, and nothing is written', async () => {
    const dj = h.client();
    await dj.login('dj');
    for (const [method, path, json] of jsonRoutes) {
      const res = await dj[method](path, { json });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    for (const path of htmlRoutes) {
      const res = await dj.get(path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get('location'), '/admin/login?staff=1');
    }
    assert.equal(await h.count('SELECT COUNT(*) FROM dj_roster'), 0);
    assert.equal(await h.count('SELECT COUNT(*) FROM broadcasts'), 0);
  });
});

describe("existing broadcast routes hide 'djs' rows from non-staff", () => {
  test('404 on every route for a DJ broadcast; listener rows unaffected', async () => {
    await h.addDj({ phone_number: h.fake(110) });
    const staff = h.client();
    await staff.login('staff');
    const draft = await staff.post('/admin/djs/broadcasts', { json: { body: 'Studio A is down.' } });
    assert.equal(draft.status, 200);
    const id = draft.data.id;

    const dj = h.client();
    await dj.login('dj');
    const attempts = [
      dj.get(`/admin/broadcasts/${id}`),
      dj.get(`/admin/broadcasts/${id}/status`),
      dj.patch(`/admin/broadcasts/${id}`, { json: { body: 'changed' } }),
      dj.post(`/admin/broadcasts/${id}/test-send`, { json: { phone: '901-555-0160' } }),
      dj.post(`/admin/broadcasts/${id}/confirm`, { json: {} }),
      dj.post(`/admin/broadcasts/${id}/cancel`, { json: {} })
    ];
    for (const res of await Promise.all(attempts)) {
      assert.equal(res.status, 404);
    }
    assert.equal(h.twilioService.dryRun.outbox.length, 0);
    const { rows: [row] } = await h.pool.query('SELECT status, body FROM broadcasts WHERE id = $1', [id]);
    assert.deepEqual(row, { status: 'draft', body: 'Studio A is down.' });

    // Staff can see it.
    assert.equal((await staff.get(`/admin/broadcasts/${id}`)).status, 200);
    assert.equal((await staff.get(`/admin/broadcasts/${id}/status`)).status, 200);
  });

  test('history hides DJ rows from non-staff and shows the audience column to staff', async () => {
    await h.pool.query(`INSERT INTO broadcasts (body, audience) VALUES ('LISTENER-NOTE', 'listeners'), ('DJ-ONLY-NOTE', 'djs')`);
    const dj = h.client();
    await dj.login('dj');
    let res = await dj.get('/admin/broadcasts');
    assert.match(res.text, /LISTENER-NOTE/);
    assert.doesNotMatch(res.text, /DJ-ONLY-NOTE/);
    assert.doesNotMatch(res.text, /<th>Audience<\/th>/);
    assert.doesNotMatch(res.text, /href="\/admin\/djs"/);

    const staff = h.client();
    await staff.login('staff');
    res = await staff.get('/admin/broadcasts');
    assert.match(res.text, /LISTENER-NOTE/);
    assert.match(res.text, /DJ-ONLY-NOTE/);
    assert.match(res.text, /<th>Audience<\/th>/);
    assert.match(res.text, /href="\/admin\/djs"/);
  });

  test('the listener draft route can never create a DJ broadcast', async () => {
    const dj = h.client();
    await dj.login('dj');
    const res = await dj.post('/admin/broadcasts', { json: { body: 'hi', audience: 'djs' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.audience, 'listeners');
  });
});

describe('HTML escaping on the new pages', () => {
  test('roster, replies feed, compose and status pages escape stored values', async () => {
    const evil = '<script>alert(1)</script>';
    const dj = await h.addDj({
      phone_number: h.fake(120), first_name: '<b>Bad', last_name: 'Name"\'', show_name: evil
    });
    await h.pool.query(
      `INSERT INTO dj_inbound_messages (dj_id, phone_number, body) VALUES ($1, $2, $3)`,
      [dj.id, dj.phone_number, `${evil} & <img src=x onerror=alert(2)>`]
    );
    await h.pool.query(
      `INSERT INTO dj_outbound_replies (dj_id, slack_ts, body, status, error) VALUES ($1, '1.1', $2, 'skipped', $3)`,
      [dj.id, '&lt;img src=x onerror=alert(3)&gt;', evil]
    );
    const staff = h.client();
    await staff.login('staff');

    let res = await staff.get('/admin/djs');
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(res.text, /<img src=x/);
    assert.doesNotMatch(res.text, /<b>Bad/);
    assert.match(res.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(res.text, /&lt;b&gt;Bad/);
    // The roster JSON embedded in the inline script can't close the tag.
    const scripts = res.text.split('<script>').length - 1;
    assert.equal(scripts, 1);

    const draft = await staff.post('/admin/djs/broadcasts', { json: { body: evil } });
    res = await staff.get(`/admin/broadcasts/${draft.data.id}`);
    assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
    assert.match(res.text, /WYXR DJs: &lt;script&gt;/);

    res = await staff.get('/admin/djs/message');
    assert.equal(res.status, 200);
    assert.match(res.text, /DJs only\. Goes to <span id="recipient-count">\d+<\/span> DJs, not listeners\./);
  });
});
