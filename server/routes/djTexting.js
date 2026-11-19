// DJ texting group: roster, DJ-only compose page, replies feed.
//
// Mounted under /admin. Every route requires the staff login
// (STAFF_USERNAME/STAFF_PASSWORD); the shared DJ login gets 403 (JSON) or is
// sent to the login form (HTML). DJs live in dj_roster, never in contacts.
//
// DJ broadcasts reuse the broadcast routes in routes/broadcasts.js: a draft
// is created here with audience='djs', then test-send, confirm, status and
// cancel go through /admin/broadcasts/:id/*, which hide 'djs' rows from
// non-staff. See DJ_TEXTING.md.
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireStaff, requireStaffAdmin } = require('../middleware/auth');
const { escapeHtml } = require('../utils/html');
const { normalizePhone } = require('../utils/phone');
const { COMPLIANCE_SUFFIX, DJ_PREFIX, DJ_SUFFIX } = require('../utils/smsText');
const { getRecipientCounts } = require('../services/broadcastAudience');
const twilioService = require('../services/twilio');
const slack = require('../services/slack');
const { helpers } = require('./broadcasts');

const { createDraftHandler, page, jsonForScript, CLIENT_MEASURE_JS, MAX_CHARACTERS, DJ_SENDING_OFF } = helpers;

const NAME_MAX = 100;
const SHOW_MAX = 200;

const formatPhone = (e164) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 || '');
};

const statusOf = (dj) => {
  if (!dj.active) return { key: 'removed', label: 'Removed' };
  if (dj.opted_out) return { key: 'optedout', label: 'Opted out' };
  if (dj.opted_in) return { key: 'signedup', label: 'Signed up' };
  return { key: 'waiting', label: 'Waiting to sign up' };
};

/**
 * Validate add/edit input. Phone is required. Names are optional, but if
 * one is filled both are required (blank both = the app asks the DJ by
 * text after they sign up). Names are trimmed and capped at 100 characters.
 */
const parseDjInput = (input = {}) => {
  const phone = normalizePhone(input.phone);
  if (!phone) return { error: 'Enter a valid US mobile number.' };

  const firstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
  if ((firstName && !lastName) || (!firstName && lastName)) {
    return { error: 'Enter both a first and last name, or leave both blank.' };
  }
  if (firstName.length > NAME_MAX || lastName.length > NAME_MAX) {
    return { error: `First and last name can be at most ${NAME_MAX} characters each.` };
  }

  // Show is required: with this many DJs, names alone are hard to tell apart
  // on the roster and in Slack.
  const showName = typeof input.showName === 'string' ? input.showName.trim() : '';
  if (!showName) return { error: 'Enter the DJ\'s show name.' };
  if (showName.length > SHOW_MAX) return { error: `Show name can be at most ${SHOW_MAX} characters.` };

  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 2000) : null;

  return {
    value: {
      phone,
      firstName: firstName || null,
      lastName: lastName || null,
      showName: showName || null,
      notes: notes || null
    }
  };
};

const djJson = (dj) => ({
  id: dj.id,
  phone: dj.phone_number,
  firstName: dj.first_name,
  lastName: dj.last_name,
  showName: dj.show_name,
  active: dj.active,
  optedIn: dj.opted_in,
  optedOut: dj.opted_out,
  status: statusOf(dj).key,
  needsName: !slack.hasName(dj)
});

// ---------------------------------------------------------------------------
// JSON endpoints
// ---------------------------------------------------------------------------

// POST /admin/djs - add a DJ (or bring back a removed one with the same number)
router.post('/djs', requireStaff, async (req, res) => {
  const { value, error } = parseDjInput(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const { rows: [existing] } = await pool.query(
      'SELECT * FROM dj_roster WHERE phone_number = $1',
      [value.phone]
    );
    if (existing && existing.active) {
      return res.status(409).json({ error: 'That number is already on the DJ roster.' });
    }

    let row;
    if (existing) {
      ({ rows: [row] } = await pool.query(
        `UPDATE dj_roster
         SET active = true, first_name = $2, last_name = $3, show_name = $4,
             notes = COALESCE($5, notes),
             name_requested_at = CASE WHEN $2::varchar IS NOT NULL THEN NULL ELSE name_requested_at END
         WHERE id = $1 RETURNING *`,
        [existing.id, value.firstName, value.lastName, value.showName, value.notes]
      ));
    } else {
      ({ rows: [row] } = await pool.query(
        `INSERT INTO dj_roster (phone_number, first_name, last_name, show_name, notes, added_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [value.phone, value.firstName, value.lastName, value.showName, value.notes, req.session.username || null]
      ));
    }
    res.json(djJson(row));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That number is already on the DJ roster.' });
    console.error('Error adding DJ:', err);
    res.status(500).json({ error: 'Failed to add DJ' });
  }
});

// PATCH /admin/djs/:id - edit name, show and phone. Saving both names
// clears name_requested_at so the app stops waiting for a texted name.
router.patch('/djs/:id', requireStaff, async (req, res) => {
  const { value, error } = parseDjInput(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const { rows: [row] } = await pool.query(
      `UPDATE dj_roster
       SET phone_number = $2, first_name = $3, last_name = $4, show_name = $5,
           notes = COALESCE($6, notes),
           name_requested_at = CASE WHEN $3::varchar IS NOT NULL THEN NULL ELSE name_requested_at END
       WHERE id = $1 RETURNING *`,
      [req.params.id, value.phone, value.firstName, value.lastName, value.showName, value.notes]
    );
    if (!row) return res.status(404).json({ error: 'DJ not found' });
    res.json(djJson(row));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Another DJ already has that number.' });
    if (err.code === '22P02') return res.status(404).json({ error: 'DJ not found' });
    console.error('Error editing DJ:', err);
    res.status(500).json({ error: 'Failed to update DJ' });
  }
});

// POST /admin/djs/:id/remove - soft remove; rows are never deleted.
router.post('/djs/:id/remove', requireStaff, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      'UPDATE dj_roster SET active = false WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'DJ not found' });
    res.json(djJson(row));
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'DJ not found' });
    console.error('Error removing DJ:', err);
    res.status(500).json({ error: 'Failed to remove DJ' });
  }
});

// POST /admin/djs/messages/:id/read - mark a DJ reply read or unread
router.post('/djs/messages/:id/read', requireStaff, async (req, res) => {
  const read = req.body.read !== false;
  try {
    const { rows: [row] } = await pool.query(
      'UPDATE dj_inbound_messages SET read = $2 WHERE id = $1 RETURNING id, read',
      [req.params.id, read]
    );
    if (!row) return res.status(404).json({ error: 'Message not found' });
    res.json(row);
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Message not found' });
    console.error('Error marking DJ reply:', err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// GET /admin/djs/recipient-count - live DJ audience
router.get('/djs/recipient-count', requireStaff, async (req, res) => {
  try {
    res.json(await getRecipientCounts('djs'));
  } catch (err) {
    console.error('Error counting DJ recipients:', err);
    res.status(500).json({ error: 'Failed to count DJs' });
  }
});

// POST /admin/djs/broadcasts - create a DJ broadcast draft. Everything after
// this goes through the shared /admin/broadcasts/:id routes.
router.post('/djs/broadcasts', requireStaff, createDraftHandler('djs'));

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const DJ_STYLES = `
  <style>
    .badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:0.8rem; font-weight:600; margin-right:4px; }
    .badge-signedup { background:#4ade80; color:#1a1a1a; }
    .badge-waiting { background:#374151; color:#d1d5db; }
    .badge-optedout { background:#ef4444; color:#fff; }
    .badge-removed { background:#1f2937; color:#9ca3af; border:1px solid #4b5563; }
    .badge-needsname { background:#FFC629; color:#1a1a1a; }
    .notice { background:#3a2a10; border:2px solid #FFC629; color:#FFC629; padding:14px 18px; border-radius:8px; margin-bottom:20px; }
    .instruction { font-size:1.4rem; color:#FFC629; font-weight:700; }
    .form-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:12px; }
    .reply { padding:14px; border-bottom:1px solid #333; border-left:4px solid #E9407A; }
    .reply.unread { background:#2a2410; border-left-color:#FFC629; }
    .reply.out { border-left-color:#2B9EB3; }
    .chip { display:inline-block; font-size:0.72rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; padding:2px 8px; border-radius:999px; margin-right:8px; vertical-align:middle; }
    .chip-dj { background:#E9407A; color:#fff; }
    .chip-staff { background:#2B9EB3; color:#fff; }
    .chip-new { background:#FFC629; color:#1a1a1a; }
    .reply .who { font-weight:600; color:#FFC629; }
    .reply .meta { color:#888; font-size:0.85rem; margin-top:4px; }
    .reply .text { margin-top:6px; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
    tr.removed td { opacity:0.55; }
    .table-wrap { overflow-x:auto; }
    .btn-small { padding:6px 12px; font-size:0.85rem; }
  </style>`;

const notices = () => {
  const out = [];
  if (!twilioService.djFromNumber()) {
    out.push(`<div class="notice">${escapeHtml(DJ_SENDING_OFF)} DJ broadcasts, test sends and Slack replies are disabled until it is set.</div>`);
  }
  if (!slack.isConfigured()) {
    out.push('<div class="notice">Slack is off: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET and SLACK_DJ_CHANNEL_ID must all be set. DJ replies are still saved and listed below.</div>');
  }
  return out.join('');
};

// GET /admin/djs - roster, sign-up instruction, latest replies
router.get('/djs', requireStaffAdmin, async (req, res) => {
  try {
    const [{ rows: roster }, { rows: feed }, counts] = await Promise.all([
      pool.query(
        `SELECT * FROM dj_roster
         ORDER BY active DESC, lower(COALESCE(last_name, '')), lower(COALESCE(first_name, '')), id`
      ),
      pool.query(
        `SELECT x.*, d.first_name, d.last_name, d.show_name, d.phone_number AS dj_phone, d.active AS dj_active
         FROM (
           SELECT 'in' AS kind, m.id, m.dj_id, m.phone_number, m.body, m.received_at AS at,
                  m.read, NULL::text AS status, NULL::text AS error
           FROM dj_inbound_messages m
           UNION ALL
           SELECT 'out', o.id, o.dj_id, NULL, o.body, o.created_at, true, o.status, o.error
           FROM dj_outbound_replies o
         ) x
         LEFT JOIN dj_roster d ON d.id = x.dj_id
         ORDER BY x.at DESC
         LIMIT 50`
      ),
      getRecipientCounts('djs')
    ]);

    const djNumber = twilioService.djFromNumber();
    const instruction = djNumber
      ? `<p class="instruction">Text DJ to ${escapeHtml(formatPhone(djNumber))}</p>
         <p class="muted" style="margin-top:8px;">Add the DJ below first. They text <strong>DJ</strong>, get a confirmation request, and reply <strong>YES</strong>. The app never texts a DJ first.</p>`
      : '<p class="muted">The DJ line number is not configured yet.</p>';

    const rosterRows = roster.length === 0
      ? '<tr><td colspan="6" class="muted">No DJs yet. Add one below.</td></tr>'
      : roster.map((dj) => {
        const st = statusOf(dj);
        return `
        <tr class="${dj.active ? '' : 'removed'}">
          <td>${escapeHtml(dj.first_name || '')}</td>
          <td>${escapeHtml(dj.last_name || '')}</td>
          <td>${escapeHtml(dj.show_name || '')}</td>
          <td>${escapeHtml(formatPhone(dj.phone_number))}</td>
          <td>
            <span class="badge badge-${st.key}">${escapeHtml(st.label)}</span>
            ${slack.hasName(dj) ? '' : '<span class="badge badge-needsname">Needs name</span>'}
          </td>
          <td style="white-space:nowrap;">
            <button class="btn btn-primary btn-small" data-edit="${dj.id}">Edit</button>
            ${dj.active ? `<button class="btn btn-danger btn-small" data-remove="${dj.id}">Remove</button>` : ''}
          </td>
        </tr>`;
      }).join('');

    const whoFor = (r) => {
      if (!r.dj_id) return 'Unknown number';
      const name = slack.hasName(r) ? `${r.first_name} ${r.last_name}` : `Name not on file (…${String(r.dj_phone || '').slice(-4)})`;
      return name + (r.show_name ? ` · ${r.show_name}` : '') + (r.dj_active === false ? ' (removed)' : '');
    };

    const feedHtml = feed.length === 0
      ? '<p class="muted" style="padding:14px;">No DJ replies yet.</p>'
      : feed.map((r) => r.kind === 'in'
        ? `
        <div class="reply${r.read ? '' : ' unread'}" id="in-${r.id}">
          <div class="who"><span class="chip chip-dj">Text from DJ</span>${r.read ? '' : '<span class="chip chip-new">New</span>'}${escapeHtml(whoFor(r))}</div>
          <div class="text">${escapeHtml(r.body)}</div>
          <div class="meta">${escapeHtml(new Date(r.at).toLocaleString())}
            <button class="btn btn-primary btn-small" style="margin-left:10px;" data-read="${r.id}" data-read-value="${r.read ? 'false' : 'true'}">
              ${r.read ? 'Mark unread' : 'Mark read'}
            </button>
          </div>
        </div>`
        : `
        <div class="reply out">
          <div class="who"><span class="chip chip-staff">Staff reply via Slack</span>to ${escapeHtml(whoFor(r))}</div>
          <div class="text">${escapeHtml(slack.slackToPlainText(r.body))}</div>
          <div class="meta">${escapeHtml(new Date(r.at).toLocaleString())} · via Slack · ${escapeHtml(r.status || 'sending')}${r.error ? ' · ' + escapeHtml(r.error) : ''}</div>
        </div>`).join('');

    const body = `${DJ_STYLES}
  ${notices()}
  <div class="stats">
    <div class="stat-card"><h3>Get group texts</h3><div class="number">${counts.count}</div></div>
    <div class="stat-card"><h3>Signed up, no name</h3><div class="number">${counts.missingName}</div></div>
    <div class="stat-card"><h3>Waiting to sign up</h3><div class="number">${counts.waiting}</div></div>
    <div class="stat-card"><h3>Opted out</h3><div class="number">${counts.optedOut}</div></div>
  </div>

  <div class="panel">
    <h2>How DJs sign up</h2>
    ${instruction}
    <div style="margin-top:16px;"><a href="/admin/djs/message" class="nav-link" style="background:#E9407A;">Text all DJs</a></div>
  </div>

  <div class="panel" id="form-panel">
    <h2 id="form-title">Add a DJ</h2>
    <p class="muted" style="margin-bottom:12px;">Phone and show are required. Leave both names blank and the app will ask the DJ by text after they reply YES. A DJ gets no group texts until a first and last name is on file.</p>
    <div class="form-grid">
      <div><label for="f-first">First name</label><input type="text" id="f-first" maxlength="${NAME_MAX}"></div>
      <div><label for="f-last">Last name</label><input type="text" id="f-last" maxlength="${NAME_MAX}"></div>
      <div><label for="f-show">Show (required)</label><input type="text" id="f-show" maxlength="${SHOW_MAX}" required></div>
      <div><label for="f-phone">Phone (required)</label><input type="tel" id="f-phone" placeholder="901-555-1234" required></div>
    </div>
    <button class="btn btn-primary" id="save-btn">Add DJ</button>
    <button class="btn" id="cancel-edit" style="display:none; background:#444; color:#fff;">Cancel</button>
    <div class="warn" id="form-error"></div>
  </div>

  <div class="panel" style="padding:0; overflow:hidden;">
    <div class="table-wrap">
      <table>
        <thead><tr><th>First name</th><th>Last name</th><th>Show</th><th>Phone</th><th>Status</th><th></th></tr></thead>
        <tbody>${rosterRows}</tbody>
      </table>
    </div>
  </div>

  <div class="panel" style="padding:0;">
    <h2 style="padding:20px 20px 0;">Latest DJ replies and staff answers</h2>
    <p class="muted" style="padding:6px 20px 10px;">Answer a DJ by replying in their thread in the staff Slack channel.</p>
    ${feedHtml}
  </div>`;

    const script = `
  const ROSTER = ${jsonForScript(roster.map(djJson))};
  let editingId = null;
  const $ = (id) => document.getElementById(id);

  async function call(url, method, payload) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function resetForm() {
    editingId = null;
    ['f-first', 'f-last', 'f-show', 'f-phone'].forEach((id) => { $(id).value = ''; });
    $('form-title').textContent = 'Add a DJ';
    $('save-btn').textContent = 'Add DJ';
    $('cancel-edit').style.display = 'none';
    $('form-error').textContent = '';
  }

  $('save-btn').addEventListener('click', async () => {
    $('form-error').textContent = '';
    const payload = {
      firstName: $('f-first').value, lastName: $('f-last').value,
      showName: $('f-show').value, phone: $('f-phone').value
    };
    try {
      if (editingId) await call('/admin/djs/' + editingId, 'PATCH', payload);
      else await call('/admin/djs', 'POST', payload);
      location.reload();
    } catch (err) { $('form-error').textContent = err.message; }
  });
  $('cancel-edit').addEventListener('click', resetForm);

  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.edit) {
      const dj = ROSTER.find((d) => String(d.id) === t.dataset.edit);
      if (!dj) return;
      editingId = dj.id;
      $('f-first').value = dj.firstName || '';
      $('f-last').value = dj.lastName || '';
      $('f-show').value = dj.showName || '';
      $('f-phone').value = dj.phone || '';
      $('form-title').textContent = 'Edit DJ';
      $('save-btn').textContent = 'Save changes';
      $('cancel-edit').style.display = 'inline-block';
      $('form-panel').scrollIntoView({ behavior: 'smooth' });
    } else if (t.dataset.remove) {
      if (!confirm('Remove this DJ from the roster? They will stop getting DJ texts. Their history is kept.')) return;
      try { await call('/admin/djs/' + t.dataset.remove + '/remove', 'POST'); location.reload(); }
      catch (err) { alert(err.message); }
    } else if (t.dataset.read) {
      try {
        await call('/admin/djs/messages/' + t.dataset.read + '/read', 'POST', { read: t.dataset.readValue === 'true' });
        location.reload();
      } catch (err) { alert(err.message); }
    }
  });
`;

    res.send(page({
      title: 'DJs - WYXR Admin',
      heading: 'DJ roster & replies',
      subtitle: 'Who gets DJ texts, who has signed up, and what DJs have texted back',
      active: 'djs',
      role: 'staff',
      body,
      script
    }));
  } catch (err) {
    console.error('Error rendering DJ roster:', err);
    res.status(500).send('Error loading the DJ roster');
  }
});

// GET /admin/djs/message - DJ-only compose page
router.get('/djs/message', requireStaffAdmin, async (req, res) => {
  try {
    const counts = await getRecipientCounts('djs');
    const sendingOff = !twilioService.djFromNumber();

    const missingNote = counts.missingName > 0
      ? `<p class="muted" style="margin-top:10px;" id="missing-note">${counts.missingName} signed-up DJ${counts.missingName === 1 ? ' is' : 's are'} left out because a first or last name is missing. Add names on the <a href="/admin/djs" style="color:#2B9EB3;">roster</a>.</p>`
      : '<p class="muted" style="margin-top:10px;" id="missing-note"></p>';

    const body = `
  ${notices()}
  <p class="dj-banner" id="dj-banner">DJs only. Goes to <span id="recipient-count">${counts.count}</span> DJs, not listeners.</p>
  ${missingNote}

  <div class="panel" style="margin-top:20px;">
    <h2>Message</h2>
    <label for="body">What do you want to tell the DJs?</label>
    <textarea id="body" placeholder="Studio A board is down Thursday 2-4pm. Please use Studio B."></textarea>
    <div class="counter" id="counter">0 characters &middot; 0 segments</div>
    <div class="suffix-note">Added automatically: &ldquo;${escapeHtml(DJ_PREFIX.trim())}&rdquo; on the first line and &ldquo;${escapeHtml(COMPLIANCE_SUFFIX.trim())}&rdquo; on the last, with your message on its own lines in between. Both count toward the length.</div>
    <div class="suffix-note" id="preview" style="font-style:normal; color:#ccc; white-space:pre-wrap;"></div>
    <div class="warn" id="shortener-warn" style="display:none;"></div>
  </div>

  <div class="panel">
    <h2>Send a test first</h2>
    <p class="muted" style="margin-bottom:14px;">Sends the exact text from the DJ line to one phone.</p>
    <div class="row">
      <input type="tel" id="test-phone" placeholder="901-555-1234">
      <button class="btn btn-primary" id="test-btn"${sendingOff ? ' disabled' : ''}>Send test</button>
    </div>
    <div class="muted" id="test-result" style="margin-top:12px;"></div>
  </div>

  <div class="panel danger-zone">
    <h2>Send to DJs</h2>
    <p class="muted">Goes to every signed-up DJ with a name on file, from the DJ line. It cannot be undone.</p>
    <button class="btn btn-danger" id="send-btn" style="margin-top:14px;"${sendingOff ? ' disabled' : ''}>Send to DJs</button>
    <div class="warn" id="send-error"></div>
  </div>`;

    const script = `
  const MAX_CHARACTERS = ${MAX_CHARACTERS};
  const PREFIX = ${jsonForScript(DJ_PREFIX)};
  const SUFFIX = ${jsonForScript(DJ_SUFFIX)};
  const SHORTENERS = ${jsonForScript(require('../utils/smsText').SHORTENER_DOMAINS)};
  let draftId = null;
  let liveCount = ${counts.count};

  const bodyEl = document.getElementById('body');
  const counterEl = document.getElementById('counter');
  const previewEl = document.getElementById('preview');
  const warnEl = document.getElementById('shortener-warn');
  const sendBtn = document.getElementById('send-btn');
  const sendError = document.getElementById('send-error');
${CLIENT_MEASURE_JS}
  function refreshCounter() {
    const full = PREFIX + bodyEl.value.trim() + SUFFIX;
    const m = measure(full);
    counterEl.textContent = m.len + ' / ' + m.single + ' characters \\u00b7 '
      + m.segments + ' segment' + (m.segments === 1 ? '' : 's') + ' (' + m.encoding + ')';
    const nextBoundary = m.segments <= 1 ? m.single : m.segments * 153;
    counterEl.className = 'counter' + (m.len > nextBoundary - 20 ? ' near-limit' : '');
    previewEl.textContent = 'DJs will see:\\n\\n' + full;
    const hits = SHORTENERS.filter(d => bodyEl.value.toLowerCase().includes(d));
    warnEl.style.display = hits.length ? 'block' : 'none';
    warnEl.textContent = hits.length ? 'Shortened links (' + hits.join(', ') + ') are a common cause of carrier filtering.' : '';
  }

  async function saveDraft() {
    const body = bodyEl.value.trim();
    if (!body) throw new Error('Enter a message first');
    const url = draftId ? '/admin/broadcasts/' + draftId : '/admin/djs/broadcasts';
    const res = await fetch(url, {
      method: draftId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ body })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save the message');
    draftId = data.id;
    return data;
  }

  async function refreshCount() {
    const res = await fetch('/admin/djs/recipient-count', { credentials: 'same-origin' });
    if (!res.ok) return liveCount;
    const data = await res.json();
    liveCount = data.count;
    document.getElementById('recipient-count').textContent = liveCount;
    return liveCount;
  }

  bodyEl.addEventListener('input', refreshCounter);

  document.getElementById('test-btn').addEventListener('click', async () => {
    const out = document.getElementById('test-result');
    const phone = document.getElementById('test-phone').value.trim();
    out.textContent = 'Sending...';
    try {
      await saveDraft();
      const res = await fetch('/admin/broadcasts/' + draftId + '/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      out.textContent = data.success ? 'Test sent to ' + data.sentTo + '. Check your phone.' : (data.error || 'Test send failed');
    } catch (err) {
      out.textContent = err.message;
    }
  });

  sendBtn.addEventListener('click', async () => {
    sendError.textContent = '';
    try {
      await saveDraft();
      const count = await refreshCount();
      if (count === 0) throw new Error('No DJs can get this yet: nobody is signed up with a name on file.');
      if (!confirm('Send this to ' + count + ' DJ' + (count === 1 ? '' : 's') + '? It cannot be undone.')) return;
      sendBtn.disabled = true;
      const res = await fetch('/admin/broadcasts/' + draftId + '/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ confirmedRecipientCount: count })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the send');
      window.location.href = '/admin/broadcasts/' + data.id;
    } catch (err) {
      sendError.textContent = err.message;
      sendBtn.disabled = false;
    }
  });

  refreshCounter();
  refreshCount();
`;

    res.send(page({
      title: 'Text DJs - WYXR Admin',
      heading: 'Text all DJs',
      subtitle: 'Sent from the DJ line, never to listeners',
      active: 'dj-message',
      role: 'staff',
      body,
      script
    }));
  } catch (err) {
    console.error('Error rendering DJ compose page:', err);
    res.status(500).send('Error loading the DJ compose page');
  }
});

module.exports = router;
module.exports.parseDjInput = parseDjInput;
