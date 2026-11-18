// Shared test setup. Require this FIRST in every test file: it pins the
// environment before any app module reads it.
//
// - SMS_DRY_RUN / SLACK_DRY_RUN: nothing reaches Twilio or Slack. The
//   services also refuse real calls under NODE_ENV=test as a second guard.
// - A local throwaway database only (the guard below refuses anything else).
// - No server/.env is loaded (dotenv lives in server.js, not app.js).
// - Every phone number is a fictional 555-01xx number; every Slack id and
//   token is made up. This repo is public.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

Object.assign(process.env, {
  NODE_ENV: 'test',
  SMS_DRY_RUN: 'true',
  SLACK_DRY_RUN: 'true',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/wyxr_texts_dj_test',
  SESSION_SECRET: 'test-session-secret',
  AUTH_USERNAME: 'shared-dj',
  AUTH_PASSWORD: 'shared-dj-password',
  STAFF_USERNAME: 'staff-user',
  STAFF_PASSWORD: 'staff-password',
  TWILIO_ACCOUNT_SID: 'ACfake',
  TWILIO_AUTH_TOKEN: 'fake-auth-token',
  TWILIO_PHONE_NUMBER: '+19015550100',
  DJ_TWILIO_PHONE_NUMBER: '+19015550101',
  SLACK_BOT_TOKEN: 'xoxb-fake-test-token',
  SLACK_SIGNING_SECRET: 'fake-signing-secret',
  SLACK_DJ_CHANNEL_ID: 'CFAKECHAN',
  FRONTEND_URL: 'http://localhost:3000',
  BROADCAST_MIN_INTERVAL_MINUTES: '30',
  DJ_BROADCAST_MIN_INTERVAL_MINUTES: '2'
});

const dbUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_test')) {
  throw new Error(`Tests only run against a local *_test database, not ${dbUrl.hostname}${dbUrl.pathname}`);
}

const ORIGIN = 'http://localhost:3000';
const LISTENER_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const DJ_NUMBER = process.env.DJ_TWILIO_PHONE_NUMBER;
// Fictional numbers for DJs, listeners and strangers.
const fake = (n) => `+1901555${String(n).padStart(4, '0')}`; // fake(110) -> +19015550110

const pool = require('../config/database');
const twilioService = require('../services/twilio');
const slack = require('../services/slack');
const { drain } = require('../utils/afterResponse');

async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  // 007 must be safe to run on top of the updated schema.sql.
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/migrations/007_add_dj_texting.sql'), 'utf8'));
  twilioService.dryRun.reset();
  slack.dryRun.reset();
}

let appModule = null;
let baseUrl = null;

async function startApp() {
  appModule = require('../app');
  await new Promise((resolve) => appModule.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${appModule.server.address().port}`;
  return baseUrl;
}

async function stopApp() {
  await drain();
  if (appModule) {
    appModule.io.close();
    await new Promise((resolve) => appModule.server.close(() => resolve()));
  }
  await pool.end();
}

/** A tiny cookie-keeping HTTP client. */
function client() {
  let cookie = null;
  const request = async (method, urlPath, { json, form, headers = {}, origin = true } = {}) => {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (origin && method !== 'GET') h.Origin = ORIGIN;
    let body;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(baseUrl + urlPath, { method, headers: h, body, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html or empty */ }
    return { status: res.status, headers: res.headers, text, data };
  };
  return {
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    patch: (p, o) => request('PATCH', p, o),
    async login(role) {
      const creds = role === 'staff'
        ? { username: process.env.STAFF_USERNAME, password: process.env.STAFF_PASSWORD }
        : { username: process.env.AUTH_USERNAME, password: process.env.AUTH_PASSWORD };
      const res = await request('POST', '/api/login', { json: creds, origin: false });
      if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
      return res;
    }
  };
}

/** POST a Twilio-style form to a webhook path. */
async function twilioPost(urlPath, params, headers = {}) {
  const res = await fetch(baseUrl + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString()
  });
  const text = await res.text();
  await drain();
  return { status: res.status, text };
}

const djText = (from, body) => twilioPost('/webhook/dj-sms', { From: from, Body: body, To: DJ_NUMBER });

/** Sign and POST a Slack event body. */
async function slackPost(payload, { secret = process.env.SLACK_SIGNING_SECRET, timestamp, signature } = {}) {
  const raw = JSON.stringify(payload);
  const ts = timestamp || String(Math.floor(Date.now() / 1000));
  const sig = signature || 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex');
  const res = await fetch(baseUrl + '/slack/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': sig
    },
    body: raw
  });
  const text = await res.text();
  await drain();
  return { status: res.status, text };
}

async function addDj(fields = {}) {
  const f = {
    phone_number: fake(200),
    first_name: 'Test',
    last_name: 'Deejay',
    show_name: null,
    active: true,
    opted_in: true,
    opt_in_method: 'sms_keyword',
    opt_in_requested_at: new Date(),
    opted_out: false,
    name_requested_at: null,
    name_request_count: 0,
    ...fields
  };
  const cols = Object.keys(f);
  const { rows: [row] } = await pool.query(
    `INSERT INTO dj_roster (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`,
    cols.map((c) => f[c])
  );
  return row;
}

async function addListener(phone, fields = {}) {
  const f = { phone_number: phone, opted_in: true, opt_in_method: 'sms', opted_out: false, ...fields };
  const cols = Object.keys(f);
  await pool.query(
    `INSERT INTO contacts (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`,
    cols.map((c) => f[c])
  );
}

const getDj = async (id) => (await pool.query('SELECT * FROM dj_roster WHERE id = $1', [id])).rows[0];
const count = async (sql, params = []) => parseInt((await pool.query(sql, params)).rows[0].count, 10);

module.exports = {
  ORIGIN, LISTENER_NUMBER, DJ_NUMBER, fake,
  pool, twilioService, slack, drain,
  resetDb, startApp, stopApp, client, twilioPost, djText, slackPost,
  addDj, addListener, getDj, count
};
