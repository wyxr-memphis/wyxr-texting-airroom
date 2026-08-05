// Broadcast (bulk SMS) admin routes.
//
// Mounted under /admin. HTML pages use requireAuthAdmin (redirect to login);
// JSON/fetch endpoints use requireAuth (401). All state-changing routes here
// are covered by the CSRF origin check in server.js — same-origin fetch from
// these pages carries an Origin header, but curl testing needs -H "Origin: ...".
//
// See BROADCAST_MESSAGING_SPEC.md §6 and §9.
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAuthAdmin } = require('../middleware/auth');
const { escapeHtml } = require('../utils/html');
const { normalizePhone } = require('../utils/phone');
const twilioService = require('../services/twilio');
const { measure, fullTextFor, findShorteners, COMPLIANCE_SUFFIX } = require('../utils/smsText');
const { getRecipientCounts, snapshotRecipients } = require('../services/broadcastAudience');

const MAX_CHARACTERS = parseInt(process.env.BROADCAST_MAX_CHARACTERS || '1200', 10);
const MAX_RECIPIENTS = parseInt(process.env.BROADCAST_MAX_RECIPIENTS || '2000', 10);
const MIN_INTERVAL_MINUTES = parseInt(process.env.BROADCAST_MIN_INTERVAL_MINUTES || '30', 10);
const SEND_INTERVAL_MS = parseInt(process.env.BROADCAST_SEND_INTERVAL_MS || '1100', 10);

// Tolerance for the confirm-time count check. The list can legitimately shift
// by a contact or two between preview and confirm (someone texts in, someone
// replies STOP); a larger drift means the page has been open a long time and
// staff should look again before sending.
const COUNT_DRIFT_TOLERANCE = 5;

const measureBody = (body) => measure(fullTextFor(body));

const ERROR_LABELS = {
  21610: 'Opted out at carrier level',
  21408: 'Unsupported region',
  21614: 'Invalid number',
  21211: 'Invalid number',
  21612: 'Unreachable number',
  21617: 'Message too long',
  21618: 'Empty message'
};

const errorLabel = (code) => ERROR_LABELS[parseInt(code, 10)] || 'Delivery error';

// ---------------------------------------------------------------------------
// JSON endpoints
// ---------------------------------------------------------------------------

// GET /admin/broadcasts/recipient-count
router.get('/broadcasts/recipient-count', requireAuth, async (req, res) => {
  try {
    res.json(await getRecipientCounts());
  } catch (error) {
    console.error('Error counting broadcast recipients:', error);
    res.status(500).json({ error: 'Failed to count recipients' });
  }
});

const validateBody = (body) => {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return 'Message body is required';
  }
  const measured = measureBody(body);
  if (measured.characterCount > MAX_CHARACTERS) {
    return `Message is too long (${measured.characterCount} characters, max ${MAX_CHARACTERS})`;
  }
  return null;
};

const broadcastPayload = (row) => ({
  id: row.id,
  body: row.body,
  fullText: fullTextFor(row.body),
  characterCount: row.character_count,
  segmentCount: row.segment_count,
  encoding: row.encoding,
  status: row.status,
  shortenerWarnings: findShorteners(row.body)
});

// POST /admin/broadcasts - create a draft
router.post('/broadcasts', requireAuth, async (req, res) => {
  const { body } = req.body;
  const invalid = validateBody(body);
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const measured = measureBody(body);
    const { rows: [row] } = await pool.query(
      `INSERT INTO broadcasts (body, character_count, segment_count, encoding, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        body.trim(),
        measured.characterCount,
        measured.segmentCount,
        measured.encoding,
        req.session.username || null
      ]
    );
    res.json(broadcastPayload(row));
  } catch (error) {
    console.error('Error creating broadcast:', error);
    res.status(500).json({ error: 'Failed to create broadcast' });
  }
});

// PATCH /admin/broadcasts/:id - edit a draft
router.patch('/broadcasts/:id', requireAuth, async (req, res) => {
  const { body } = req.body;
  const invalid = validateBody(body);
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const measured = measureBody(body);
    const { rows: [row] } = await pool.query(
      `UPDATE broadcasts
       SET body = $1, character_count = $2, segment_count = $3, encoding = $4
       WHERE id = $5 AND status = 'draft'
       RETURNING *`,
      [body.trim(), measured.characterCount, measured.segmentCount, measured.encoding, req.params.id]
    );

    if (!row) {
      const { rows: [existing] } = await pool.query(
        'SELECT status FROM broadcasts WHERE id = $1',
        [req.params.id]
      );
      if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
      return res.status(409).json({ error: 'Cannot edit a broadcast that has already been sent' });
    }

    res.json(broadcastPayload(row));
  } catch (error) {
    console.error('Error updating broadcast:', error);
    res.status(500).json({ error: 'Failed to update broadcast' });
  }
});

// POST /admin/broadcasts/:id/test-send - send the exact text to one number
router.post('/broadcasts/:id/test-send', requireAuth, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }

  try {
    const { rows: [broadcast] } = await pool.query(
      'SELECT * FROM broadcasts WHERE id = $1',
      [req.params.id]
    );
    if (!broadcast) return res.status(404).json({ success: false, error: 'Broadcast not found' });

    // Deliberately bypasses broadcast_recipients and the opt-in check: this is
    // staff texting their own phone to proof the message before sending.
    await twilioService.sendSMS(phone, fullTextFor(broadcast.body));

    await pool.query(
      'UPDATE broadcasts SET last_test_sent_at = NOW(), last_test_phone = $1 WHERE id = $2',
      [phone, broadcast.id]
    );

    res.json({ success: true, sentTo: phone });
  } catch (error) {
    console.error('Error sending broadcast test message:', error.message);
    res.status(502).json({ success: false, error: 'Twilio rejected the test message' });
  }
});

// POST /admin/broadcasts/:id/confirm - the irreversible trigger
router.post('/broadcasts/:id/confirm', requireAuth, async (req, res) => {
  const { confirmedRecipientCount } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: [broadcast] } = await client.query(
      'SELECT * FROM broadcasts WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );

    if (!broadcast) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Broadcast not found' });
    }
    if (broadcast.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This broadcast has already been sent' });
    }

    // One in flight at a time.
    const { rows: active } = await client.query(
      "SELECT id FROM broadcasts WHERE status = 'sending' LIMIT 1"
    );
    if (active.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Another broadcast is currently sending. Only one broadcast can be in flight at a time.'
      });
    }

    // Cooldown since the last confirmed send.
    const { rows: [recent] } = await client.query(
      `SELECT confirmed_at,
              EXTRACT(EPOCH FROM (NOW() - confirmed_at)) / 60 AS minutes_ago
       FROM broadcasts
       WHERE confirmed_at IS NOT NULL
       ORDER BY confirmed_at DESC
       LIMIT 1`
    );
    if (recent && Number(recent.minutes_ago) < MIN_INTERVAL_MINUTES) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error: `A broadcast was sent ${Math.round(recent.minutes_ago)} minutes ago. `
          + `Wait until the ${MIN_INTERVAL_MINUTES}-minute cooldown passes before sending another.`
      });
    }

    // Re-check the audience live rather than trusting the compose page.
    const live = await getRecipientCounts();

    if (live.count === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No eligible recipients — nothing to send.' });
    }
    if (live.count > MAX_RECIPIENTS) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Recipient count (${live.count}) exceeds the configured maximum of ${MAX_RECIPIENTS}.`
      });
    }
    if (
      Number.isInteger(confirmedRecipientCount) &&
      Math.abs(confirmedRecipientCount - live.count) > COUNT_DRIFT_TOLERANCE
    ) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Recipient count changed since you last checked (was ${confirmedRecipientCount}, `
          + `now ${live.count}). Please refresh and confirm again.`
      });
    }

    await snapshotRecipients(client, broadcast.id);

    // The AND status='draft' is the atomic guard against two simultaneous
    // confirm clicks: whichever transaction commits first wins, and the
    // second no longer matches.
    const { rows: [updated] } = await client.query(
      `UPDATE broadcasts
       SET status = 'sending',
           confirmed_at = NOW(),
           started_at = NOW(),
           created_by = COALESCE(created_by, $2),
           recipient_count = (
             SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = $1
           )
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [broadcast.id, req.session.username || null]
    );

    if (!updated) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This broadcast has already been sent' });
    }

    await client.query('COMMIT');

    console.log(
      `[broadcast] ${req.session.username || 'unknown'} confirmed broadcast ${updated.id} `
      + `to ${updated.recipient_count} recipients`
    );

    res.json({
      id: updated.id,
      status: updated.status,
      recipientCount: updated.recipient_count
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error confirming broadcast:', error);
    res.status(500).json({ error: 'Failed to confirm broadcast' });
  } finally {
    client.release();
  }
});

// GET /admin/broadcasts/:id/status - polled by the status page
router.get('/broadcasts/:id/status', requireAuth, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT b.*,
              COUNT(r.*) FILTER (WHERE r.status IN ('pending', 'sending')) AS pending_count
       FROM broadcasts b
       LEFT JOIN broadcast_recipients r ON r.broadcast_id = b.id
       WHERE b.id = $1
       GROUP BY b.id`,
      [req.params.id]
    );

    if (!row) return res.status(404).json({ error: 'Broadcast not found' });

    const pendingCount = parseInt(row.pending_count, 10);
    res.json({
      status: row.status,
      recipientCount: row.recipient_count,
      sentCount: row.sent_count,
      failedCount: row.failed_count,
      skippedCount: row.skipped_count,
      pendingCount,
      startedAt: row.started_at,
      estimatedCompletionAt:
        row.status === 'sending'
          ? new Date(Date.now() + pendingCount * SEND_INTERVAL_MS).toISOString()
          : null
    });
  } catch (error) {
    console.error('Error fetching broadcast status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// POST /admin/broadcasts/:id/cancel
router.post('/broadcasts/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { rows: [canceled] } = await pool.query(
      `UPDATE broadcasts
       SET status = 'canceled', canceled_at = NOW(), canceled_by = $2
       WHERE id = $1 AND status = 'sending'
       RETURNING *`,
      [req.params.id, req.session.username || null]
    );

    if (!canceled) {
      const { rows: [existing] } = await pool.query(
        'SELECT status FROM broadcasts WHERE id = $1',
        [req.params.id]
      );
      if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
      return res.status(409).json({ error: `Cannot cancel a broadcast that is ${existing.status}` });
    }

    // Rows already claimed ('sending') are left alone — the Twilio call may
    // already be in flight. The worker won't claim anything new for a
    // broadcast that is no longer 'sending'.
    const { rowCount: skipped } = await pool.query(
      `UPDATE broadcast_recipients
       SET status = 'skipped'
       WHERE broadcast_id = $1 AND status = 'pending'`,
      [req.params.id]
    );

    const { rows: [totals] } = await pool.query(
      `UPDATE broadcasts SET skipped_count = skipped_count + $2
       WHERE id = $1 RETURNING sent_count, skipped_count`,
      [req.params.id, skipped]
    );

    console.log(
      `[broadcast] ${req.session.username || 'unknown'} canceled broadcast ${req.params.id} `
      + `(${skipped} recipients skipped)`
    );

    res.json({
      id: canceled.id,
      status: 'canceled',
      sentCount: totals.sent_count,
      skippedCount: totals.skipped_count
    });
  } catch (error) {
    console.error('Error canceling broadcast:', error);
    res.status(500).json({ error: 'Failed to cancel broadcast' });
  }
});

// ---------------------------------------------------------------------------
// Server-rendered admin pages
//
// Inline <style>/<script> matches the existing admin panel convention (no
// shared CSS file, no build step). helmet runs with contentSecurityPolicy
// disabled, which is what makes the inline segment counter viable — see spec §2.
// ---------------------------------------------------------------------------

const SHARED_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #2B2B2B;
      color: #fff;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #2B2B2B 0%, #1a1a1a 100%);
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
      border: 2px solid #E9407A;
    }
    .header h1 { color: #FFC629; font-size: 2.5rem; margin-bottom: 10px; }
    .header p { color: #E9407A; font-size: 1.1rem; margin-bottom: 20px; }
    .nav-links { display: flex; gap: 15px; margin-top: 20px; flex-wrap: wrap; }
    .nav-link {
      padding: 10px 20px; background: #2B9EB3; color: white; text-decoration: none;
      border-radius: 6px; font-weight: 500; transition: background 0.2s;
    }
    .nav-link:hover { background: #248a9e; }
    .nav-link.active { background: #FFC629; color: #2B2B2B; }
    .stats { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat-card {
      background: #1a1a1a; padding: 20px; border-radius: 8px;
      border: 2px solid #2B9EB3; flex: 1; min-width: 150px;
    }
    .stat-card h3 {
      color: #2B9EB3; font-size: 0.9rem; margin-bottom: 10px; text-transform: uppercase;
    }
    .stat-card .number { color: #FFC629; font-size: 2rem; font-weight: bold; }
    .panel {
      background: #1a1a1a; border-radius: 8px; border: 2px solid #2B9EB3;
      padding: 24px; margin-bottom: 24px;
    }
    .panel h2 { color: #FFC629; font-size: 1.3rem; margin-bottom: 16px; }
    label { display: block; margin-bottom: 8px; color: #ccc; font-weight: 500; }
    textarea, input[type="text"], input[type="tel"] {
      width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #444;
      background: #2B2B2B; color: #fff; font-size: 1rem; font-family: inherit;
    }
    textarea { min-height: 110px; resize: vertical; }
    .btn {
      padding: 10px 20px; border: none; border-radius: 6px; font-weight: 600;
      cursor: pointer; font-size: 0.95rem; transition: background 0.2s;
    }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary { background: #2B9EB3; color: white; }
    .btn-primary:hover:not(:disabled) { background: #248a9e; }
    .btn-danger { background: #E9407A; color: white; }
    .btn-danger:hover:not(:disabled) { background: #c9285f; }
    .muted { color: #888; font-size: 0.9rem; line-height: 1.5; }
    .warn { color: #FFC629; font-size: 0.9rem; margin-top: 10px; }
    .danger-zone { border-color: #E9407A; }
    .counter { margin-top: 10px; font-size: 0.9rem; color: #888; }
    .counter.near-limit { color: #FFC629; font-weight: 600; }
    .suffix-note {
      margin-top: 10px; padding: 10px; background: #2B2B2B; border-radius: 6px;
      color: #888; font-size: 0.85rem; font-style: italic;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #2B2B2B; color: #FFC629; padding: 15px; text-align: left;
      font-weight: 600; border-bottom: 2px solid #2B9EB3;
    }
    td { padding: 15px; border-bottom: 1px solid #333; }
    tr:hover { background: #252525; }
    .status-badge {
      display: inline-block; padding: 4px 12px; border-radius: 12px;
      font-size: 0.85rem; font-weight: 600;
    }
    .status-completed { background: #4ade80; color: #1a1a1a; }
    .status-sending { background: #FFC629; color: #1a1a1a; }
    .status-draft { background: #374151; color: #9ca3af; }
    .status-canceled { background: #ef4444; color: white; }
    .timestamp { color: #888; font-size: 0.85rem; }
    .progress-track {
      background: #2B2B2B; border-radius: 999px; height: 22px;
      overflow: hidden; margin: 18px 0 10px;
    }
    .progress-fill {
      background: #FFC629; height: 100%; transition: width 0.4s ease;
    }
    .row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .row > input { flex: 1; min-width: 200px; }
`;

const navLinks = (active) => `
    <div class="nav-links">
      <a href="/admin/messages" class="nav-link${active === 'messages' ? ' active' : ''}">Messages</a>
      <a href="/admin/contacts" class="nav-link${active === 'contacts' ? ' active' : ''}">Contacts</a>
      <a href="/admin/broadcasts" class="nav-link${active === 'broadcasts' ? ' active' : ''}">Broadcasts</a>
    </div>`;

const page = ({ title, heading, subtitle, active, body, script }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    ${navLinks(active)}
  </div>
  ${body}
  <script>${script || ''}</script>
</body>
</html>`;

// Safe JSON for embedding in an inline <script>: the </ split prevents a value
// containing "</script>" from closing the tag early.
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// GET /admin/broadcasts/new - compose page. Declared before /broadcasts/:id so
// "new" is never captured as an id.
router.get('/broadcasts/new', requireAuthAdmin, async (req, res) => {
  try {
    const counts = await getRecipientCounts();

    const importedNote = counts.excludedImported > 0
      ? `<p class="muted" style="margin-top:14px;">
           ${counts.excludedImported} imported contact${counts.excludedImported === 1 ? '' : 's'}
           ${counts.excludedImported === 1 ? 'is' : 'are'} not included. Their opt-in was attested by
           staff at import rather than confirmed by the listener. To include them, re-import without
           the consent attestation so they receive a confirmation text — replying YES makes them
           eligible automatically.
         </p>`
      : '';

    const body = `
  <div class="stats">
    <div class="stat-card">
      <h3>Recipients</h3>
      <div class="number" id="recipient-count">${counts.count}</div>
    </div>
    <div class="stat-card">
      <h3>Texted in</h3>
      <div class="number">${counts.byMethod.sms}</div>
    </div>
    <div class="stat-card">
      <h3>Web form</h3>
      <div class="number">${counts.byMethod.web}</div>
    </div>
  </div>

  <div class="panel">
    <h2>Message</h2>
    <label for="body">What do you want to send?</label>
    <textarea id="body" placeholder="WYXR 91.7 FM: ..."></textarea>
    <div class="counter" id="counter">0 characters &middot; 0 segments</div>
    <div class="suffix-note">This is added automatically: &ldquo;${escapeHtml(COMPLIANCE_SUFFIX.trim())}&rdquo;</div>
    <div class="warn" id="shortener-warn" style="display:none;"></div>
    ${importedNote}
  </div>

  <div class="panel">
    <h2>Send a test first</h2>
    <p class="muted" style="margin-bottom:14px;">
      Text it to your own phone and read it on a real handset before sending to everyone.
    </p>
    <div class="row">
      <input type="tel" id="test-phone" placeholder="901-555-1234">
      <button class="btn btn-primary" id="test-btn">Send test</button>
    </div>
    <div class="muted" id="test-result" style="margin-top:12px;"></div>
  </div>

  <div class="panel danger-zone">
    <h2>Confirm &amp; send</h2>
    <p class="muted">
      This sends to every eligible listener and <strong>cannot be undone</strong>.
      Type <code id="phrase-hint"></code> below to enable the send button.
    </p>
    <div class="row" style="margin-top:14px;">
      <input type="text" id="confirm-phrase" placeholder="SEND TO ...">
      <button class="btn btn-danger" id="send-btn" disabled>Send</button>
    </div>
    <div class="warn" id="send-error"></div>
  </div>`;

    const script = `
  const MAX_CHARACTERS = ${MAX_CHARACTERS};
  const SUFFIX = ${jsonForScript(COMPLIANCE_SUFFIX)};
  const SHORTENERS = ${jsonForScript(require('../utils/smsText').SHORTENER_DOMAINS)};
  let draftId = null;
  let liveCount = ${counts.count};

  const bodyEl = document.getElementById('body');
  const counterEl = document.getElementById('counter');
  const warnEl = document.getElementById('shortener-warn');
  const phraseHint = document.getElementById('phrase-hint');
  const phraseEl = document.getElementById('confirm-phrase');
  const sendBtn = document.getElementById('send-btn');
  const sendError = document.getElementById('send-error');

  const GSM7_BASIC = ${jsonForScript(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
    + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
  )};
  const GSM7_EXT = ${jsonForScript('^{}\\[~]|€')};
  const basic = new Set(GSM7_BASIC), ext = new Set(GSM7_EXT);

  // Mirrors server/utils/smsText.js — the server recomputes authoritatively at
  // save time, this is just so staff see the boundary while typing.
  function measure(text) {
    const chars = Array.from(text);
    const gsm7 = chars.every(c => basic.has(c) || ext.has(c));
    const len = gsm7 ? chars.reduce((n, c) => n + (ext.has(c) ? 2 : 1), 0) : text.length;
    const single = gsm7 ? 160 : 70, multi = gsm7 ? 153 : 67;
    const segments = len === 0 ? 0 : (len <= single ? 1 : Math.ceil(len / multi));
    return { len, segments, encoding: gsm7 ? 'GSM-7' : 'UCS-2', single };
  }

  function refreshCounter() {
    const full = bodyEl.value.trim() + SUFFIX;
    const m = measure(full);
    counterEl.textContent = m.len + ' / ' + m.single + ' characters \\u00b7 '
      + m.segments + ' segment' + (m.segments === 1 ? '' : 's') + ' (' + m.encoding + ')';
    const nextBoundary = m.segments <= 1 ? m.single : m.segments * 153;
    counterEl.className = 'counter' + (m.len > nextBoundary - 20 ? ' near-limit' : '');

    const hits = SHORTENERS.filter(d => bodyEl.value.toLowerCase().includes(d));
    if (hits.length) {
      warnEl.style.display = 'block';
      warnEl.textContent = 'Shortened links (' + hits.join(', ') + ') are a common cause of '
        + 'carrier filtering. Use a full wyxr.org link if you can.';
    } else {
      warnEl.style.display = 'none';
    }
  }

  async function saveDraft() {
    const body = bodyEl.value.trim();
    if (!body) throw new Error('Enter a message first');
    const url = draftId ? '/admin/broadcasts/' + draftId : '/admin/broadcasts';
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
    const res = await fetch('/admin/broadcasts/recipient-count', { credentials: 'same-origin' });
    if (!res.ok) return liveCount;
    const data = await res.json();
    liveCount = data.count;
    document.getElementById('recipient-count').textContent = liveCount;
    phraseHint.textContent = 'SEND TO ' + liveCount;
    phraseEl.placeholder = 'SEND TO ' + liveCount;
    checkPhrase();
    return liveCount;
  }

  function checkPhrase() {
    const expected = 'SEND TO ' + liveCount;
    sendBtn.disabled = phraseEl.value.trim().toUpperCase() !== expected;
    sendBtn.textContent = 'Send to ' + liveCount + ' recipients \\u2014 cannot be undone';
  }

  bodyEl.addEventListener('input', refreshCounter);
  phraseEl.addEventListener('input', checkPhrase);

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
      out.textContent = data.success
        ? 'Test sent to ' + data.sentTo + '. Check your phone.'
        : (data.error || 'Test send failed');
    } catch (err) {
      out.textContent = err.message;
    }
  });

  sendBtn.addEventListener('click', async () => {
    sendError.textContent = '';
    sendBtn.disabled = true;
    try {
      await saveDraft();
      // Re-check the count immediately before sending so a stale tab can't
      // confirm against a number that has since moved.
      const count = await refreshCount();
      const res = await fetch('/admin/broadcasts/' + draftId + '/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ confirmedRecipientCount: count })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the broadcast');
      window.location.href = '/admin/broadcasts/' + data.id;
    } catch (err) {
      sendError.textContent = err.message;
      checkPhrase();
    }
  });

  refreshCounter();
  refreshCount();
`;

    res.send(page({
      title: 'New Broadcast - WYXR Admin',
      heading: 'New Broadcast',
      subtitle: 'Send one message to every listener who opted in',
      active: 'broadcasts',
      body,
      script
    }));
  } catch (error) {
    console.error('Error rendering compose page:', error);
    res.status(500).send('Error loading the compose page');
  }
});

// GET /admin/broadcasts - history
router.get('/broadcasts', requireAuthAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM broadcasts ORDER BY COALESCE(confirmed_at, created_at) DESC LIMIT 100`
    );

    const rowsHtml = rows.length === 0
      ? '<tr><td colspan="6" class="muted">No broadcasts yet.</td></tr>'
      : rows.map((b) => `
        <tr>
          <td class="timestamp">${new Date(b.confirmed_at || b.created_at).toLocaleString()}</td>
          <td>${escapeHtml(b.body.length > 70 ? b.body.slice(0, 70) + '…' : b.body)}</td>
          <td><span class="status-badge status-${escapeHtml(b.status)}">${escapeHtml(b.status)}</span></td>
          <td>${b.recipient_count}</td>
          <td>${b.sent_count} sent${b.failed_count > 0 ? ` / ${b.failed_count} failed` : ''}</td>
          <td><a href="/admin/broadcasts/${b.id}" class="nav-link" style="padding:6px 14px;">View</a></td>
        </tr>`).join('');

    const body = `
  <div style="margin-bottom:20px;">
    <a href="/admin/broadcasts/new" class="nav-link" style="background:#2B9EB3;">+ New Broadcast</a>
  </div>
  <div class="panel" style="padding:0; overflow:hidden;">
    <table>
      <thead>
        <tr><th>When</th><th>Message</th><th>Status</th><th>Recipients</th><th>Delivery</th><th></th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;

    res.send(page({
      title: 'Broadcasts - WYXR Admin',
      heading: 'Broadcasts',
      subtitle: 'Station announcements sent to the opted-in list',
      active: 'broadcasts',
      body
    }));
  } catch (error) {
    console.error('Error loading broadcasts:', error);
    res.status(500).send('Error loading broadcasts');
  }
});

// GET /admin/broadcasts/:id - status / progress page
router.get('/broadcasts/:id', requireAuthAdmin, async (req, res) => {
  try {
    const { rows: [broadcast] } = await pool.query(
      'SELECT * FROM broadcasts WHERE id = $1',
      [req.params.id]
    );
    if (!broadcast) return res.status(404).send('Broadcast not found');

    const { rows: failures } = await pool.query(
      `SELECT error_code, COUNT(*) AS count
       FROM broadcast_recipients
       WHERE broadcast_id = $1 AND status = 'failed_permanent'
       GROUP BY error_code
       ORDER BY count DESC`,
      [req.params.id]
    );

    const failureHtml = failures.length === 0
      ? ''
      : `
  <div class="panel">
    <h2>Delivery failures</h2>
    <table>
      <thead><tr><th>Code</th><th>Reason</th><th>Count</th></tr></thead>
      <tbody>${failures.map((f) => `
        <tr>
          <td>${escapeHtml(f.error_code || 'unknown')}</td>
          <td>${escapeHtml(errorLabel(f.error_code))}</td>
          <td>${f.count}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

    const body = `
  <div class="panel">
    <h2>Message</h2>
    <p style="line-height:1.6;">${escapeHtml(fullTextFor(broadcast.body))}</p>
    <p class="muted" style="margin-top:12px;">
      ${broadcast.character_count} characters &middot; ${broadcast.segment_count} segment(s)
      &middot; ${escapeHtml(broadcast.encoding || '')}
      ${broadcast.created_by ? ' &middot; created by ' + escapeHtml(broadcast.created_by) : ''}
    </p>
  </div>

  <div class="stats">
    <div class="stat-card"><h3>Sent</h3><div class="number" id="sent">${broadcast.sent_count}</div></div>
    <div class="stat-card"><h3>Failed</h3><div class="number" id="failed">${broadcast.failed_count}</div></div>
    <div class="stat-card"><h3>Skipped</h3><div class="number" id="skipped">${broadcast.skipped_count}</div></div>
    <div class="stat-card"><h3>Remaining</h3><div class="number" id="remaining">–</div></div>
  </div>

  <div class="panel">
    <h2>Progress <span class="status-badge status-${escapeHtml(broadcast.status)}" id="status-badge">${escapeHtml(broadcast.status)}</span></h2>
    <div class="progress-track"><div class="progress-fill" id="bar" style="width:0%"></div></div>
    <p class="muted" id="eta">–</p>
    <button class="btn btn-danger" id="cancel-btn" style="margin-top:16px; display:none;">Cancel broadcast</button>
    <div class="warn" id="cancel-error"></div>
  </div>
  ${failureHtml}`;

    const script = `
  const ID = ${broadcast.id};
  const total = ${broadcast.recipient_count || 0};
  const cancelBtn = document.getElementById('cancel-btn');
  let polling = true;

  function render(s) {
    document.getElementById('sent').textContent = s.sentCount;
    document.getElementById('failed').textContent = s.failedCount;
    document.getElementById('skipped').textContent = s.skippedCount;
    document.getElementById('remaining').textContent = s.pendingCount;
    const badge = document.getElementById('status-badge');
    badge.textContent = s.status;
    badge.className = 'status-badge status-' + s.status;

    const done = s.sentCount + s.failedCount + s.skippedCount;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('bar').style.width = pct + '%';

    if (s.status === 'sending') {
      cancelBtn.style.display = 'inline-block';
      if (s.estimatedCompletionAt) {
        const mins = Math.max(0, Math.round((new Date(s.estimatedCompletionAt) - Date.now()) / 60000));
        document.getElementById('eta').textContent = pct + '% complete \\u00b7 about '
          + mins + ' minute' + (mins === 1 ? '' : 's') + ' remaining';
      }
    } else {
      cancelBtn.style.display = 'none';
      document.getElementById('eta').textContent = pct + '% complete \\u00b7 ' + s.status;
      polling = false;
    }
  }

  async function poll() {
    if (!polling) return;
    try {
      const res = await fetch('/admin/broadcasts/' + ID + '/status', { credentials: 'same-origin' });
      if (res.ok) render(await res.json());
    } catch (e) { /* transient - try again next tick */ }
    if (polling) setTimeout(poll, 4000);
  }

  cancelBtn.addEventListener('click', async () => {
    if (!confirm('Stop this broadcast? Listeners already texted will keep their message.')) return;
    cancelBtn.disabled = true;
    try {
      const res = await fetch('/admin/broadcasts/' + ID + '/cancel', {
        method: 'POST', credentials: 'same-origin'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel');
      poll();
    } catch (err) {
      document.getElementById('cancel-error').textContent = err.message;
    } finally {
      cancelBtn.disabled = false;
    }
  });

  poll();
`;

    res.send(page({
      title: `Broadcast #${broadcast.id} - WYXR Admin`,
      heading: `Broadcast #${broadcast.id}`,
      subtitle: 'Delivery progress',
      active: 'broadcasts',
      body,
      script
    }));
  } catch (error) {
    console.error('Error loading broadcast status page:', error);
    res.status(500).send('Error loading broadcast');
  }
});

module.exports = router;
