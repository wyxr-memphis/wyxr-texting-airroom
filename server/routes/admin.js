const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAuthAdmin } = require('../middleware/auth');
const { verifyCredentials } = require('../utils/credentials');
const { loginLimiters } = require('../middleware/loginLimiter');
const { escapeHtml } = require('../utils/html');

// GET /admin/login - Login form for admin panel
router.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/admin/messages');
  }
  const error = req.query.error ? '<p style="color:#E9407A;margin-bottom:16px;">Invalid username or password.</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WYXR Admin Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #2B2B2B; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #3a3a3a; border-radius: 12px; padding: 40px; width: 100%; max-width: 360px; }
    h1 { color: #FFC629; font-size: 24px; margin-bottom: 8px; }
    p.sub { color: #aaa; font-size: 14px; margin-bottom: 28px; }
    label { display: block; font-size: 13px; color: #ccc; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; background: #2B2B2B; border: 1px solid #555; border-radius: 6px; color: #fff; font-size: 15px; margin-bottom: 16px; }
    input:focus { outline: none; border-color: #2B9EB3; }
    button { width: 100%; padding: 12px; background: #2B9EB3; border: none; border-radius: 6px; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
    button:hover { background: #24899c; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WYXR Admin</h1>
    <p class="sub">Sign in to access the admin panel</p>
    ${error}
    <form method="POST" action="/admin/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`);
});

// POST /admin/login - Authenticate and redirect
router.post('/login', ...loginLimiters, (req, res) => {
  const { username, password } = req.body;
  if (verifyCredentials(username, password)) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/admin/messages');
  }
  console.warn(`Failed login attempt on /admin/login from IP ${req.ip}`);
  return res.redirect('/admin/login?error=1');
});

// GET /admin/messages/search - Search and filter messages (API endpoint)
router.get('/messages/search', requireAuth, async (req, res) => {
  try {
    const {
      search,
      phone,
      startDate,
      endDate,
      read,
      replied,
      limit = 100,
      offset = 0
    } = req.query;

    // Build WHERE clauses dynamically
    const conditions = ['1=1'];
    const params = [];
    let paramCount = 1;

    // Text search (phone OR message content)
    if (search) {
      conditions.push(`(m.text ILIKE $${paramCount} OR m.phone ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    // Phone filter
    if (phone) {
      conditions.push(`m.phone = $${paramCount}`);
      params.push(phone);
      paramCount++;
    }

    // Date range
    if (startDate) {
      conditions.push(`m.timestamp >= $${paramCount}`);
      params.push(startDate);
      paramCount++;
    }
    if (endDate) {
      conditions.push(`m.timestamp <= $${paramCount}`);
      params.push(endDate);
      paramCount++;
    }

    // Read status
    if (read === 'true') {
      conditions.push('m.read = true');
    } else if (read === 'false') {
      conditions.push('m.read = false');
    }

    // Replied status
    if (replied === 'true') {
      conditions.push('m.replied = true');
    } else if (replied === 'false') {
      conditions.push('m.replied = false');
    }

    // Add limit and offset
    params.push(limit, offset);

    const query = `
      SELECT m.*,
             EXISTS(SELECT 1 FROM blocked_numbers b WHERE b.phone = m.phone) as is_blocked,
             COALESCE(c.opted_in, false) as opted_in
      FROM messages m
      LEFT JOIN contacts c ON m.phone = c.phone_number
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.timestamp DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const result = await pool.query(query, params);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
      WHERE ${conditions.join(' AND ')}
    `;
    const countResult = await pool.query(countQuery, params.slice(0, -2));

    res.json({
      messages: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// GET /admin/messages - View all messages (admin interface)
router.get('/messages', requireAuthAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.phone, m.text, m.timestamp, m.read, m.replied, m.reply_text, m.replied_at, m.created_at,
             COALESCE(c.opted_in, false) as opted_in
      FROM messages m
      LEFT JOIN contacts c ON m.phone = c.phone_number
      ORDER BY m.timestamp DESC
    `);

    const messages = result.rows;

    // Fetch blocked numbers
    const blockedResult = await pool.query(
      'SELECT phone, blocked_at, blocked_by, reason, notes FROM blocked_numbers ORDER BY blocked_at DESC'
    );
    const blockedNumbers = blockedResult.rows;
    const blockedPhoneSet = new Set(blockedNumbers.map(b => b.phone));

    // Serve HTML page with all messages
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WYXR Message History - Admin</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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

    .header h1 {
      color: #FFC629;
      font-size: 2.5rem;
      margin-bottom: 10px;
    }

    .header p {
      color: #E9407A;
      font-size: 1.1rem;
      margin-bottom: 20px;
    }

    .nav-links {
      display: flex;
      gap: 15px;
      margin-top: 20px;
    }

    .nav-link {
      padding: 10px 20px;
      background: #2B9EB3;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .nav-link:hover {
      background: #248a9e;
    }

    .nav-link.active {
      background: #FFC629;
      color: #2B2B2B;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }

    .stat-card {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #2B9EB3;
      flex: 1;
      min-width: 150px;
    }

    .stat-card h3 {
      color: #2B9EB3;
      font-size: 0.9rem;
      margin-bottom: 10px;
      text-transform: uppercase;
    }

    .stat-card .number {
      color: #FFC629;
      font-size: 2rem;
      font-weight: bold;
    }

    .controls {
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      transition: all 0.2s;
      text-decoration: none;
      display: inline-block;
    }

    .btn-primary {
      background: #2B9EB3;
      color: white;
    }

    .btn-primary:hover {
      background: #247a8a;
    }

    .btn-danger {
      background: #E9407A;
      color: white;
      padding: 8px 12px;
      font-size: 0.9rem;
    }

    .btn-danger:hover {
      background: #d12a5e;
    }

    .btn-warning {
      background: #FFC629;
      color: #2B2B2B;
      padding: 8px 12px;
      font-size: 0.9rem;
    }

    .btn-warning:hover {
      background: #e6b324;
    }

    .btn-secondary {
      background: #666;
      color: white;
    }

    .btn-secondary:hover {
      background: #555;
    }

    .badge-blocked {
      background: #666;
      color: white;
    }

    .btn-reply {
      background: #2B9EB3;
      color: white;
      padding: 6px 10px;
      font-size: 0.85rem;
    }

    .btn-reply:hover {
      background: #247a8a;
    }

    .btn-read-toggle {
      background: #555;
      color: white;
      padding: 6px 10px;
      font-size: 0.85rem;
    }

    .btn-read-toggle:hover {
      background: #444;
    }

    .action-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      align-items: center;
    }

    .filter-panel {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      border: 2px solid #2B9EB3;
    }

    .filter-panel h3 {
      color: #FFC629;
      margin-bottom: 15px;
    }

    .filter-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 15px;
    }

    .filter-grid-4 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 15px;
      margin-bottom: 15px;
    }

    .filter-buttons {
      display: flex;
      gap: 10px;
    }

    .filter-input {
      padding: 10px;
      background: #2B2B2B;
      border: 2px solid #2B9EB3;
      border-radius: 6px;
      color: white;
      font-size: 14px;
    }

    .filter-input:focus {
      outline: none;
      border-color: #FFC629;
    }

    .result-info {
      color: #999;
      margin-bottom: 10px;
    }

    .search-box {
      padding: 10px 15px;
      border: 2px solid #2B9EB3;
      border-radius: 6px;
      background: #1a1a1a;
      color: white;
      font-size: 1rem;
      flex: 1;
      max-width: 400px;
    }

    .search-box:focus {
      outline: none;
      border-color: #FFC629;
    }

    .table-container {
      background: #1a1a1a;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid #2B9EB3;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      background: #2B2B2B;
    }

    th {
      padding: 15px;
      text-align: left;
      color: #FFC629;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.85rem;
      border-bottom: 2px solid #E9407A;
    }

    td {
      padding: 15px;
      border-bottom: 1px solid #333;
    }

    tr:hover {
      background: #2B2B2B;
    }

    .phone {
      color: #2B9EB3;
      font-weight: 600;
    }

    .message-text {
      max-width: 400px;
      word-wrap: break-word;
    }

    .timestamp {
      color: #999;
      font-size: 0.9rem;
    }

    .badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 600;
      display: inline-block;
    }

    .badge-read {
      background: #2B9EB3;
      color: white;
    }

    .badge-unread {
      background: #FFC629;
      color: #2B2B2B;
    }

    .badge-replied {
      background: #4CAF50;
      color: white;
    }

    .reply-text {
      color: #4CAF50;
      font-style: italic;
      margin-top: 5px;
      font-size: 0.9rem;
    }

    .no-messages {
      text-align: center;
      padding: 60px 20px;
      color: #999;
      font-size: 1.2rem;
    }

    @media (max-width: 768px) {
      .filter-grid-2,
      .filter-grid-4 {
        grid-template-columns: 1fr;
      }

      .filter-buttons {
        flex-direction: column;
      }

      .table-container {
        overflow-x: auto;
      }

      table {
        min-width: 800px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>WYXR 91.7FM</h1>
    <p>Message History - Admin Panel</p>
    <div class="nav-links">
      <a href="/admin/messages" class="nav-link active">Messages</a>
      <a href="/admin/contacts" class="nav-link">Contacts</a>
      <a href="/admin/broadcasts" class="nav-link">Broadcasts</a>
    </div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <h3>Total Messages</h3>
      <div class="number">${messages.length}</div>
    </div>
    <div class="stat-card">
      <h3>Unread</h3>
      <div class="number">${messages.filter(m => !m.read).length}</div>
    </div>
    <div class="stat-card">
      <h3>Replied</h3>
      <div class="number">${messages.filter(m => m.replied).length}</div>
    </div>
  </div>

  <div class="filter-panel">
    <h3>Search & Filter Messages</h3>

    <div class="filter-grid-2">
      <input type="text" id="searchText" placeholder="Search text or phone..." class="filter-input">
      <input type="text" id="phoneFilter" placeholder="Phone: +19015551234" class="filter-input">
    </div>

    <div class="filter-grid-4">
      <input type="date" id="startDate" class="filter-input">
      <input type="date" id="endDate" class="filter-input">

      <select id="readFilter" class="filter-input">
        <option value="all">All Messages</option>
        <option value="false">Unread Only</option>
        <option value="true">Read Only</option>
      </select>

      <select id="repliedFilter" class="filter-input">
        <option value="all">All</option>
        <option value="true">Replied</option>
        <option value="false">Not Replied</option>
      </select>
    </div>

    <div class="filter-buttons">
      <button id="applyFilters" class="btn btn-primary">Apply Filters</button>
      <button id="clearFilters" class="btn btn-secondary">Clear</button>
      <button id="exportCSV" class="btn btn-warning">Export CSV</button>
    </div>
  </div>

  <div class="result-info">
    Showing <span id="resultCount">0</span> of <span id="totalCount">0</span> messages
  </div>

  <div class="table-container">
    ${messages.length === 0 ? `
      <div class="no-messages">No messages in database</div>
    ` : `
      <table id="messagesTable">
        <thead>
          <tr>
            <th>Phone</th>
            <th>Message</th>
            <th>Received</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${messages.map(msg => `
            <tr data-id="${msg.id}">
              <td class="phone">${escapeHtml(formatPhone(msg.phone))}</td>
              <td class="message-text">
                ${escapeHtml(msg.text)}
                ${msg.replied ? `<div class="reply-text">↳ Reply: ${escapeHtml(msg.reply_text || '')}</div>` : ''}
              </td>
              <td class="timestamp">${formatDate(msg.timestamp)}</td>
              <td>
                <span class="badge ${msg.read ? 'badge-read' : 'badge-unread'}">${msg.read ? 'Read' : 'Unread'}</span>
                ${msg.replied ? '<span class="badge badge-replied">Replied</span>' : ''}
              </td>
              <td>
                <div class="action-cell">
                  <button class="btn btn-read-toggle read-toggle-btn" data-id="${msg.id}" data-read="${msg.read}">${msg.read ? 'Mark Unread' : 'Mark Read'}</button>
                  ${msg.opted_in ? `<button class="btn btn-reply reply-btn" data-id="${msg.id}" data-phone="${escapeHtml(msg.phone)}" data-text="${escapeHtml(msg.text)}">Reply</button>` : ''}
                  ${blockedPhoneSet.has(msg.phone)
                    ? '<span class="badge badge-blocked">Blocked</span>'
                    : `<button class="btn btn-warning block-btn" data-phone="${escapeHtml(msg.phone)}">Block</button>`
                  }
                  <button class="btn btn-danger delete-btn" data-id="${msg.id}">Delete</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="blocked-section" style="margin-top: 50px;">
    <h2 style="color: #FFC629; margin-bottom: 20px;">Blocked Numbers (${blockedNumbers.length})</h2>
    ${blockedNumbers.length === 0 ? `
      <div class="no-messages">No blocked numbers</div>
    ` : `
      <div class="table-container">
        <table id="blockedTable">
          <thead>
            <tr>
              <th>Phone</th>
              <th>Blocked At</th>
              <th>Blocked By</th>
              <th>Reason</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${blockedNumbers.map(block => `
              <tr>
                <td class="phone">${escapeHtml(formatPhone(block.phone))}</td>
                <td class="timestamp">${formatDate(block.blocked_at)}</td>
                <td>${escapeHtml(block.blocked_by || 'N/A')}</td>
                <td>${escapeHtml(block.reason || 'No reason')}</td>
                <td>${escapeHtml(block.notes || '-')}</td>
                <td>
                  <button class="btn btn-primary unblock-btn" data-phone="${escapeHtml(block.phone)}">Unblock</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  </div>

  <!-- Block Modal -->
  <div id="blockModal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8);">
    <div style="background: #1a1a1a; margin: 10% auto; padding: 30px; border: 2px solid #E9407A; border-radius: 8px; width: 90%; max-width: 500px; color: white;">
      <h2 style="color: #FFC629; margin-bottom: 20px;">Block Phone Number</h2>
      <p>Phone: <span id="blockPhoneDisplay" style="color: #2B9EB3; font-weight: 600;"></span></p>
      <label style="display: block; margin-top: 15px; color: #2B9EB3; font-weight: 600;">Reason (optional):</label>
      <select id="blockReason" style="width: 100%; padding: 10px; background: #2B2B2B; border: 2px solid #2B9EB3; border-radius: 6px; color: white; margin-top: 5px;">
        <option value="">Select a reason...</option>
        <option value="Inappropriate content">Inappropriate content</option>
        <option value="Spam">Spam</option>
        <option value="Harassment">Harassment</option>
        <option value="Other">Other</option>
      </select>
      <label style="display: block; margin-top: 15px; color: #2B9EB3; font-weight: 600;">Notes (optional):</label>
      <textarea id="blockNotes" rows="3" style="width: 100%; padding: 10px; background: #2B2B2B; border: 2px solid #2B9EB3; border-radius: 6px; color: white; margin-top: 5px;"></textarea>
      <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
        <button class="btn btn-danger" id="confirmBlock">Block Number</button>
        <button class="btn btn-primary" id="cancelBlock">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Reply Modal -->
  <div id="replyModal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8);">
    <div style="background: #1a1a1a; margin: 8% auto; padding: 30px; border: 2px solid #2B9EB3; border-radius: 8px; width: 90%; max-width: 540px; color: white;">
      <h2 style="color: #FFC629; margin-bottom: 6px;">Reply to <span id="replyPhoneDisplay" style="color: #2B9EB3;"></span></h2>
      <div style="color: #999; font-size: 0.9rem; margin-bottom: 16px; background: #2B2B2B; padding: 10px 14px; border-radius: 6px; border-left: 3px solid #E9407A;">
        <span style="font-size: 0.75rem; text-transform: uppercase; color: #E9407A; font-weight: 600;">Original message:</span><br>
        <span id="replyOriginalText" style="color: #ccc;"></span>
      </div>
      <div style="margin-bottom: 14px;">
        <div style="font-size: 0.8rem; color: #2B9EB3; font-weight: 600; margin-bottom: 8px; text-transform: uppercase;">Quick replies:</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          <button class="quick-reply-opt" style="padding: 6px 12px; background: #2B2B2B; border: 1px solid #2B9EB3; border-radius: 4px; color: #ccc; cursor: pointer; font-size: 0.85rem;">Thanks for listening to WYXR 91.7FM!</button>
          <button class="quick-reply-opt" style="padding: 6px 12px; background: #2B2B2B; border: 1px solid #2B9EB3; border-radius: 4px; color: #ccc; cursor: pointer; font-size: 0.85rem;">We'll play your request soon!</button>
          <button class="quick-reply-opt" style="padding: 6px 12px; background: #2B2B2B; border: 1px solid #2B9EB3; border-radius: 4px; color: #ccc; cursor: pointer; font-size: 0.85rem;">Thanks for your feedback!</button>
          <button class="quick-reply-opt" style="padding: 6px 12px; background: #2B2B2B; border: 1px solid #2B9EB3; border-radius: 4px; color: #ccc; cursor: pointer; font-size: 0.85rem;">Stay tuned to WYXR 91.7FM!</button>
        </div>
      </div>
      <textarea id="replyText" rows="4" placeholder="Type your reply..." style="width: 100%; padding: 10px; background: #2B2B2B; border: 2px solid #2B9EB3; border-radius: 6px; color: white; font-size: 0.95rem; resize: vertical;"></textarea>
      <div id="replyError" style="color: #E9407A; font-size: 0.9rem; margin-top: 8px; display: none;"></div>
      <div style="display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end;">
        <button class="btn btn-primary" id="confirmReply">Send Reply</button>
        <button class="btn btn-secondary" id="cancelReply">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    let currentFilters = {};
    let currentPage = 0;
    const PAGE_SIZE = 100;

    async function fetchMessages() {
      const params = new URLSearchParams({
        ...currentFilters,
        limit: PAGE_SIZE,
        offset: currentPage * PAGE_SIZE
      });

      // Remove empty params
      for (const [key, value] of Array.from(params.entries())) {
        if (!value || value === 'all') params.delete(key);
      }

      try {
        const response = await fetch(\`/admin/messages/search?\${params}\`, {
          credentials: 'include'
        });

        const data = await response.json();
        renderMessages(data.messages);
        updateCounts(data.total, data.messages.length);
      } catch (error) {
        console.error('Error fetching messages:', error);
        alert('Error loading messages');
      }
    }

    function renderMessages(messages) {
      const tbody = document.querySelector('#messagesTable tbody');
      if (!tbody) return;

      if (messages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #999;">No messages found</td></tr>';
        return;
      }

      tbody.innerHTML = messages.map(msg => \`
        <tr data-id="\${msg.id}">
          <td class="phone">\${escapeHtml(formatPhone(msg.phone))}</td>
          <td class="message-text">
            \${escapeHtml(msg.text)}
            \${msg.replied ? \`<div class="reply-text">↳ Reply: \${escapeHtml(msg.reply_text || '')}</div>\` : ''}
          </td>
          <td class="timestamp">\${formatDate(msg.timestamp)}</td>
          <td>
            <span class="badge \${msg.read ? 'badge-read' : 'badge-unread'}">\${msg.read ? 'Read' : 'Unread'}</span>
            \${msg.replied ? '<span class="badge badge-replied">Replied</span>' : ''}
            \${msg.is_blocked ? '<span class="badge badge-blocked">Blocked</span>' : ''}
          </td>
          <td>
            <div class="action-cell">
              <button class="btn btn-read-toggle read-toggle-btn" data-id="\${msg.id}" data-read="\${msg.read}">\${msg.read ? 'Mark Unread' : 'Mark Read'}</button>
              \${msg.opted_in ? \`<button class="btn btn-reply reply-btn" data-id="\${msg.id}" data-phone="\${escapeHtml(msg.phone)}" data-text="\${escapeHtml(msg.text)}">Reply</button>\` : ''}
              \${!msg.is_blocked ? \`<button class="btn btn-warning block-btn" data-phone="\${escapeHtml(msg.phone)}">Block</button>\` : '<span class="badge badge-blocked">Blocked</span>'}
              <button class="btn btn-danger delete-btn" data-id="\${msg.id}">Delete</button>
            </div>
          </td>
        </tr>
      \`).join('');
    }

    function updateCounts(total, filtered) {
      document.getElementById('totalCount').textContent = total;
      document.getElementById('resultCount').textContent = filtered;
    }

    function formatPhone(phone) {
      const cleaned = phone.replace(/\\D/g, '');
      if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return \`(\${cleaned.slice(1, 4)}) \${cleaned.slice(4, 7)}-\${cleaned.slice(7)}\`;
      }
      if (cleaned.length === 10) {
        return \`(\${cleaned.slice(0, 3)}) \${cleaned.slice(3, 6)}-\${cleaned.slice(6)}\`;
      }
      return phone;
    }

    function formatDate(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (hours < 1) {
        const minutes = Math.floor(diff / (1000 * 60));
        return \`\${minutes} min\${minutes !== 1 ? 's' : ''} ago\`;
      }
      if (hours < 24) {
        return \`\${hours} hour\${hours !== 1 ? 's' : ''} ago\`;
      }
      if (days < 7) {
        return \`\${days} day\${days !== 1 ? 's' : ''} ago\`;
      }

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Apply filters button
    document.getElementById('applyFilters').addEventListener('click', () => {
      currentFilters = {
        search: document.getElementById('searchText').value,
        phone: document.getElementById('phoneFilter').value,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        read: document.getElementById('readFilter').value,
        replied: document.getElementById('repliedFilter').value
      };

      currentPage = 0;
      fetchMessages();
    });

    // Clear filters button
    document.getElementById('clearFilters').addEventListener('click', () => {
      document.getElementById('searchText').value = '';
      document.getElementById('phoneFilter').value = '';
      document.getElementById('startDate').value = '';
      document.getElementById('endDate').value = '';
      document.getElementById('readFilter').value = 'all';
      document.getElementById('repliedFilter').value = 'all';

      currentFilters = {};
      currentPage = 0;
      fetchMessages();
    });

    // CSV Export
    document.getElementById('exportCSV').addEventListener('click', async () => {
      // Fetch ALL messages matching current filters (no pagination)
      const params = new URLSearchParams({
        ...currentFilters,
        limit: 10000 // Reasonable max
      });

      // Remove empty params
      for (const [key, value] of Array.from(params.entries())) {
        if (!value || value === 'all') params.delete(key);
      }

      try {
        const response = await fetch(\`/admin/messages/search?\${params}\`, {
          credentials: 'include'
        });

        const data = await response.json();
        const messages = data.messages;

        if (messages.length === 0) {
          alert('No messages to export');
          return;
        }

        // CSV Format
        const csv = [
          ['ID', 'Phone', 'Message', 'Timestamp', 'Read', 'Replied', 'Reply Text', 'Blocked'],
          ...messages.map(m => [
            m.id,
            m.phone,
            m.text.replace(/"/g, '""'),  // Escape quotes
            new Date(m.timestamp).toISOString(),
            m.read ? 'Yes' : 'No',
            m.replied ? 'Yes' : 'No',
            (m.reply_text || '').replace(/"/g, '""'),
            m.is_blocked ? 'Yes' : 'No'
          ])
        ];

        const csvContent = csv.map(row =>
          row.map(cell => \`"\${cell}"\`).join(',')
        ).join('\\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = \`wyxr-messages-\${new Date().toISOString().split('T')[0]}.csv\`;
        a.click();
        window.URL.revokeObjectURL(url);

        alert(\`Exported \${messages.length} messages to CSV\`);
      } catch (error) {
        console.error('Error exporting CSV:', error);
        alert('Error exporting CSV');
      }
    });

    // Load messages on page load
    fetchMessages();

    // Block button - show modal
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('block-btn')) {
        const phone = e.target.dataset.phone;
        document.getElementById('blockPhoneDisplay').textContent = phone;
        document.getElementById('blockModal').style.display = 'block';
        document.getElementById('blockModal').dataset.phone = phone;
      }
    });

    // Cancel block
    document.getElementById('cancelBlock').addEventListener('click', () => {
      document.getElementById('blockModal').style.display = 'none';
      document.getElementById('blockReason').value = '';
      document.getElementById('blockNotes').value = '';
    });

    // Confirm block
    document.getElementById('confirmBlock').addEventListener('click', async () => {
      const phone = document.getElementById('blockModal').dataset.phone;
      const reason = document.getElementById('blockReason').value;
      const notes = document.getElementById('blockNotes').value;

      try {
        const response = await fetch('/admin/blocked-numbers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phone, reason, notes })
        });

        if (response.ok) {
          location.reload();
        } else {
          const data = await response.json();
          alert(data.error || 'Failed to block number');
        }
      } catch (error) {
        console.error('Error blocking number:', error);
        alert('Error blocking number');
      }
    });

    // Unblock button
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('unblock-btn')) {
        const phone = e.target.dataset.phone;

        if (!confirm('Unblock this number? Future messages will appear in DJ dashboard.')) {
          return;
        }

        try {
          const response = await fetch(\`/admin/blocked-numbers/\${encodeURIComponent(phone)}\`, {
            method: 'DELETE',
            credentials: 'include'
          });

          if (response.ok) {
            location.reload();
          } else {
            alert('Failed to unblock number');
          }
        } catch (error) {
          console.error('Error unblocking number:', error);
          alert('Error unblocking number');
        }
      }
    });

    // Mark Read / Unread
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('read-toggle-btn')) {
        const id = e.target.dataset.id;
        const currentRead = e.target.dataset.read === 'true';
        try {
          const response = await fetch(\`/api/messages/\${id}/read\`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ read: !currentRead }),
            credentials: 'include'
          });
          if (response.ok) {
            fetchMessages();
          } else {
            alert('Failed to update read status');
          }
        } catch (error) {
          alert('Error updating read status');
        }
      }
    });

    // Reply button - open modal
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('reply-btn')) {
        const id = e.target.dataset.id;
        const phone = e.target.dataset.phone;
        const text = e.target.dataset.text;
        document.getElementById('replyPhoneDisplay').textContent = formatPhone(phone);
        document.getElementById('replyOriginalText').textContent = text;
        document.getElementById('replyText').value = '';
        document.getElementById('replyError').style.display = 'none';
        document.getElementById('replyModal').style.display = 'block';
        document.getElementById('replyModal').dataset.id = id;
        setTimeout(() => document.getElementById('replyText').focus(), 50);
      }
    });

    // Quick reply buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-reply-opt')) {
        document.getElementById('replyText').value = e.target.textContent;
        document.getElementById('replyText').focus();
      }
    });

    // Cancel reply
    document.getElementById('cancelReply').addEventListener('click', () => {
      document.getElementById('replyModal').style.display = 'none';
    });

    // Send reply
    document.getElementById('confirmReply').addEventListener('click', async () => {
      const id = document.getElementById('replyModal').dataset.id;
      const replyText = document.getElementById('replyText').value.trim();
      const errEl = document.getElementById('replyError');

      if (!replyText) {
        errEl.textContent = 'Please enter a reply message.';
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      document.getElementById('confirmReply').textContent = 'Sending...';
      document.getElementById('confirmReply').disabled = true;

      try {
        const response = await fetch(\`/api/messages/\${id}/reply\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replyText }),
          credentials: 'include'
        });
        if (response.ok) {
          document.getElementById('replyModal').style.display = 'none';
          fetchMessages();
        } else {
          const data = await response.json();
          errEl.textContent = data.error || 'Failed to send reply';
          errEl.style.display = 'block';
        }
      } catch (error) {
        errEl.textContent = 'Error sending reply';
        errEl.style.display = 'block';
      } finally {
        document.getElementById('confirmReply').textContent = 'Send Reply';
        document.getElementById('confirmReply').disabled = false;
      }
    });

    // Close reply modal on overlay click
    document.getElementById('replyModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('replyModal')) {
        document.getElementById('replyModal').style.display = 'none';
      }
    });

    // Delete functionality
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('delete-btn')) {
        const messageId = e.target.dataset.id;

        if (!confirm('Are you sure you want to delete this message? This cannot be undone.')) {
          return;
        }

        try {
          const response = await fetch(\`/admin/messages/\${messageId}\`, {
            method: 'DELETE',
            credentials: 'include'
          });

          if (response.ok) {
            // Remove row from table
            const row = document.querySelector(\`tr[data-id="\${messageId}"]\`);
            if (row) {
              row.style.opacity = '0';
              row.style.transition = 'opacity 0.3s';
              setTimeout(() => row.remove(), 300);
            }

            // Update stats
            setTimeout(() => location.reload(), 500);
          } else {
            alert('Failed to delete message');
          }
        } catch (error) {
          console.error('Error deleting message:', error);
          alert('Error deleting message');
        }
      }
    });
  </script>
</body>
</html>
    `);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).send('Error loading messages');
  }
});

// DELETE /admin/messages/:id - Delete a message
router.delete('/messages/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM messages WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// GET /admin/blocked-numbers - Get all blocked numbers
router.get('/blocked-numbers', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT phone, blocked_at, blocked_by, reason, notes
      FROM blocked_numbers
      ORDER BY blocked_at DESC
    `);

    res.json({ blockedNumbers: result.rows });
  } catch (error) {
    console.error('Error fetching blocked numbers:', error);
    res.status(500).json({ error: 'Failed to fetch blocked numbers' });
  }
});

// POST /admin/blocked-numbers - Block a phone number
router.post('/blocked-numbers', requireAuth, async (req, res) => {
  const { phone, reason, notes } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    // Check if already blocked
    const existing = await pool.query(
      'SELECT phone FROM blocked_numbers WHERE phone = $1',
      [phone]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Phone number is already blocked' });
    }

    // Insert into blocked_numbers
    const result = await pool.query(
      `INSERT INTO blocked_numbers (phone, blocked_by, reason, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [phone, 'admin', reason || null, notes || null]
    );

    res.json({ success: true, blockedNumber: result.rows[0] });
  } catch (error) {
    console.error('Error blocking number:', error);
    res.status(500).json({ error: 'Failed to block number' });
  }
});

// DELETE /admin/blocked-numbers/:phone - Unblock a phone number
router.delete('/blocked-numbers/:phone', requireAuth, async (req, res) => {
  const { phone } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM blocked_numbers WHERE phone = $1 RETURNING *',
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Phone number not found in blocked list' });
    }

    res.json({ success: true, message: 'Phone number unblocked' });
  } catch (error) {
    console.error('Error unblocking number:', error);
    res.status(500).json({ error: 'Failed to unblock number' });
  }
});

// Helper functions for HTML generation
function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (hours < 1) {
    const minutes = Math.floor(diff / (1000 * 60));
    return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
  }
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }
  if (days < 7) {
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit'
  });
}

// POST /admin/contacts/import - Bulk import contacts from CSV
router.post('/contacts/import', requireAuth, async (req, res) => {
  const { contacts: rows, consented, source } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'contacts array required' });
  }
  if (rows.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 rows per request' });
  }

  const { normalizePhone } = require('../utils/phone');
  const twilioService = require('../services/twilio');
  const sourceLabel = source ? source.trim().slice(0, 100) : null;

  let imported = 0, updated = 0, skipped_existing = 0, skipped_pending = 0, skipped_opted_out = 0, optInRequestsQueued = 0;
  const invalid = [];
  const pendingSMSQueue = [];

  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) {
      invalid.push({ raw: row.phone, reason: 'Invalid phone number format' });
      continue;
    }
    const firstName = row.name ? row.name.trim().slice(0, 50) || null : null;

    const existing = await pool.query('SELECT * FROM contacts WHERE phone_number = $1', [phone]);

    if (existing.rows.length === 0) {
      if (consented) {
        await pool.query(
          `INSERT INTO contacts (phone_number, first_name, opted_in, opt_in_method, opt_in_timestamp, source)
           VALUES ($1, $2, true, 'import', NOW(), $3)`,
          [phone, firstName, sourceLabel]
        );
        await pool.query(
          `INSERT INTO opt_in_log (phone_number, action_type, method, consent_text, ip_address)
           VALUES ($1, 'import_consent', 'import', $2, $3)`,
          [phone, 'Admin attested prior consent via CSV import (source: ' + (sourceLabel || 'unspecified') + ')', req.ip]
        );
        imported++;
      } else {
        await pool.query(
          `INSERT INTO contacts (phone_number, first_name, opted_in, opt_in_method, source)
           VALUES ($1, $2, false, 'import', $3)`,
          [phone, firstName, sourceLabel]
        );
        await pool.query(
          `INSERT INTO opt_in_log (phone_number, action_type, method, ip_address)
           VALUES ($1, 'import_opt_in_request', 'import', $2)`,
          [phone, req.ip]
        );
        pendingSMSQueue.push(phone);
        optInRequestsQueued++;
        imported++;
      }
    } else {
      const contact = existing.rows[0];

      // Exists, opted_out — always skip (TCPA)
      if (contact.opted_out) {
        skipped_opted_out++;
        continue;
      }

      if (contact.opted_in) {
        if (!contact.first_name && firstName) {
          await pool.query('UPDATE contacts SET first_name = $1 WHERE phone_number = $2', [firstName, phone]);
          updated++;
        } else {
          skipped_existing++;
        }
        continue;
      }

      // Exists, pending
      if (consented) {
        await pool.query(
          `UPDATE contacts SET opted_in = true, opt_in_method = 'import', opt_in_timestamp = NOW(),
           first_name = COALESCE(NULLIF(TRIM(COALESCE(first_name, '')), ''), $1),
           source = COALESCE(source, $2)
           WHERE phone_number = $3`,
          [firstName, sourceLabel, phone]
        );
        await pool.query(
          `INSERT INTO opt_in_log (phone_number, action_type, method, consent_text, ip_address)
           VALUES ($1, 'import_consent', 'import', $2, $3)`,
          [phone, 'Admin attested prior consent via CSV import (source: ' + (sourceLabel || 'unspecified') + ')', req.ip]
        );
        updated++;
      } else {
        if (!contact.first_name && firstName) {
          await pool.query('UPDATE contacts SET first_name = $1 WHERE phone_number = $2', [firstName, phone]);
        }
        skipped_pending++;
      }
    }
  }

  if (pendingSMSQueue.length > 0) {
    setImmediate(async () => {
      for (const phone of pendingSMSQueue) {
        await twilioService.sendOptInRequest(phone);
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    });
  }

  res.json({ imported, updated, skipped_existing, skipped_pending, skipped_opted_out, invalid, optInRequestsQueued });
});

// PATCH /admin/contacts/:phone - Update contact first name
router.patch('/contacts/:phone', requireAuth, async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { first_name } = req.body;
    const name = first_name !== undefined ? (first_name.trim().slice(0, 50) || null) : null;

    const result = await pool.query(
      'UPDATE contacts SET first_name = $1 WHERE phone_number = $2 RETURNING *',
      [name, phone]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Broadcast to DJ dashboards so names update in real time
    const io = req.app.get('io');
    if (io) {
      io.emit('contact:updated', { phone, first_name: name });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating contact name:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// GET /admin/contacts - View all contacts and opt-in status
router.get('/contacts', requireAuthAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.phone_number,
        c.first_name,
        c.source,
        c.opted_in,
        c.opt_in_method,
        c.opt_in_timestamp,
        c.pending_message,
        c.pending_timestamp,
        c.first_contact_timestamp,
        c.last_message_timestamp,
        c.opted_out,
        c.opted_out_timestamp,
        CASE WHEN b.phone IS NOT NULL THEN true ELSE false END as is_blocked
      FROM contacts c
      LEFT JOIN blocked_numbers b ON c.phone_number = b.phone
      ORDER BY
        CASE
          WHEN c.opted_in = true THEN 1
          WHEN c.opted_out = false AND c.opted_in = false THEN 2
          WHEN c.opted_out = true THEN 3
        END,
        c.last_message_timestamp DESC NULLS LAST
    `);

    const contacts = result.rows;
    const optedInCount = contacts.filter(c => c.opted_in).length;
    const pendingCount = contacts.filter(c => !c.opted_in && !c.opted_out).length;
    const optedOutCount = contacts.filter(c => c.opted_out).length;

    // Format phone numbers for display
    const formatPhone = (phone) => {
      if (!phone) return '';
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length === 11 && cleaned[0] === '1') {
        const areaCode = cleaned.slice(1, 4);
        const prefix = cleaned.slice(4, 7);
        const line = cleaned.slice(7);
        return `(${areaCode}) ${prefix}-${line}`;
      }
      return phone;
    };

    // Format timestamps
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return 'Never';
      return new Date(timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };

    // Serve HTML page
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WYXR Contacts - Admin</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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

    .header h1 {
      color: #FFC629;
      font-size: 2.5rem;
      margin-bottom: 10px;
    }

    .header p {
      color: #E9407A;
      font-size: 1.1rem;
      margin-bottom: 20px;
    }

    .nav-links {
      display: flex;
      gap: 15px;
      margin-top: 20px;
    }

    .nav-link {
      padding: 10px 20px;
      background: #2B9EB3;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .nav-link:hover {
      background: #248a9e;
    }

    .nav-link.active {
      background: #FFC629;
      color: #2B2B2B;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }

    .stat-card {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #2B9EB3;
      flex: 1;
      min-width: 150px;
    }

    .stat-card h3 {
      color: #2B9EB3;
      font-size: 0.9rem;
      margin-bottom: 10px;
      text-transform: uppercase;
    }

    .stat-card .number {
      color: #FFC629;
      font-size: 2rem;
      font-weight: bold;
    }

    .contacts-table {
      background: #1a1a1a;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid #2B9EB3;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      background: #2B2B2B;
      color: #FFC629;
      padding: 15px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #2B9EB3;
    }

    td {
      padding: 15px;
      border-bottom: 1px solid #333;
    }

    tr:hover {
      background: #252525;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .status-opted-in {
      background: #4ade80;
      color: #1a1a1a;
    }

    .status-pending {
      background: #FFC629;
      color: #1a1a1a;
    }

    .status-opted-out {
      background: #ef4444;
      color: white;
    }

    .method-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      background: #2B9EB3;
      color: white;
    }

    .pending-message {
      color: #888;
      font-style: italic;
      font-size: 0.9rem;
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .timestamp {
      color: #888;
      font-size: 0.85rem;
    }

    .status-blocked {
      background: #7f1d1d;
      color: #fca5a5;
    }

    .btn-block-contact {
      padding: 6px 14px;
      background: #b45309;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-block-contact:hover {
      background: #92400e;
    }

    .btn-unblock-contact {
      padding: 6px 14px;
      background: #374151;
      color: #9ca3af;
      border: 1px solid #4b5563;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-unblock-contact:hover {
      background: #4b5563;
      color: white;
    }

    .import-section {
      background: #1a1a1a;
      border-radius: 8px;
      border: 2px solid #2B9EB3;
      padding: 24px;
      margin-bottom: 24px;
    }

    .import-section h2 {
      color: #FFC629;
      font-size: 1.1rem;
      margin-bottom: 14px;
    }

    .form-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
      align-items: flex-end;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 160px;
    }

    .form-group label {
      color: #aaa;
      font-size: 0.85rem;
    }

    .form-input {
      padding: 8px 12px;
      background: #2B2B2B;
      border: 1.5px solid #555;
      border-radius: 6px;
      color: #fff;
      font-size: 14px;
    }

    .form-input:focus { outline: none; border-color: #2B9EB3; }

    .btn-import {
      padding: 8px 20px;
      background: #2B9EB3;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }

    .btn-import:hover { background: #247a8a; }

    .btn-add {
      padding: 8px 20px;
      background: #4ade80;
      color: #1a1a1a;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-add:hover { background: #22c55e; }

    .consent-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .consent-row label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      color: #ccc;
      font-size: 0.9rem;
    }

    #importResults {
      margin-top: 12px;
      padding: 12px;
      background: #2B2B2B;
      border-radius: 6px;
      font-size: 0.85rem;
      display: none;
    }

    .section-divider {
      border: none;
      border-top: 1px solid #333;
      margin: 20px 0;
    }

    .edit-name-btn {
      background: none;
      border: none;
      color: #2B9EB3;
      cursor: pointer;
      font-size: 0.8rem;
      padding: 2px 6px;
      border-radius: 3px;
      opacity: 0.6;
    }

    .edit-name-btn:hover { opacity: 1; background: #2B2B2B; }

    .name-edit-input {
      padding: 4px 8px;
      background: #2B2B2B;
      border: 1.5px solid #2B9EB3;
      border-radius: 4px;
      color: white;
      font-size: 0.85rem;
      width: 120px;
    }

    .btn-save-name { padding: 3px 8px; background: #4ade80; color: #1a1a1a; border: none; border-radius: 4px; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
    .btn-cancel-name { padding: 3px 8px; background: #555; color: white; border: none; border-radius: 4px; font-size: 0.75rem; font-weight: 600; cursor: pointer; }

    @media (max-width: 1200px) {
      .contacts-table {
        overflow-x: auto;
      }

      table {
        min-width: 1000px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>WYXR 91.7FM</h1>
    <p>SMS Opt-In Contacts - Admin Panel</p>
    <div class="nav-links">
      <a href="/admin/messages" class="nav-link">Messages</a>
      <a href="/admin/contacts" class="nav-link active">Contacts</a>
      <a href="/admin/broadcasts" class="nav-link">Broadcasts</a>
    </div>
  </div>

  <!-- Add Contact & CSV Import -->
  <div class="import-section">
    <h2>Add Contact</h2>
    <div class="form-row">
      <div class="form-group">
        <label>Name (optional)</label>
        <input type="text" id="addName" class="form-input" placeholder="First name" maxlength="50">
      </div>
      <div class="form-group">
        <label>Phone *</label>
        <input type="text" id="addPhone" class="form-input" placeholder="901-555-1234">
      </div>
      <div class="form-group">
        <label>Source</label>
        <input type="text" id="addSource" class="form-input" placeholder="e.g. Walk-in" maxlength="100">
      </div>
    </div>
    <div class="consent-row">
      <label><input type="radio" name="addConsent" value="consented" checked> Already consented</label>
      <label><input type="radio" name="addConsent" value="request"> Send opt-in request SMS</label>
      <button class="btn-add" id="addContactBtn">Add Contact</button>
    </div>
    <div id="addResult" style="margin-top:10px;font-size:0.85rem;display:none;"></div>

    <hr class="section-divider">

    <h2>CSV Import</h2>
    <p style="color:#888;font-size:0.85rem;margin-bottom:12px;">CSV columns: <code style="background:#2B2B2B;padding:1px 4px;border-radius:3px;">phone</code> and <code style="background:#2B2B2B;padding:1px 4px;border-radius:3px;">name</code> (optional). First row is header.</p>
    <div class="form-row">
      <div class="form-group">
        <label>CSV File</label>
        <input type="file" id="csvFile" accept=".csv" class="form-input">
      </div>
      <div class="form-group">
        <label>Source label (applied to every contact in batch)</label>
        <input type="text" id="csvSource" class="form-input" placeholder="e.g. Mailchimp June 2026" maxlength="100">
      </div>
    </div>
    <div class="consent-row">
      <label><input type="checkbox" id="csvConsented"> These contacts already consented (do not send opt-in SMS)</label>
      <button class="btn-import" id="importBtn">Import CSV</button>
    </div>
    <div id="importResults"></div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <h3>Total Contacts</h3>
      <div class="number">${contacts.length}</div>
    </div>
    <div class="stat-card">
      <h3>Opted In</h3>
      <div class="number">${optedInCount}</div>
    </div>
    <div class="stat-card">
      <h3>Pending</h3>
      <div class="number">${pendingCount}</div>
    </div>
    <div class="stat-card">
      <h3>Opted Out</h3>
      <div class="number">${optedOutCount}</div>
    </div>
  </div>

  <div class="contacts-table">
    <table>
      <thead>
        <tr>
          <th>Phone Number</th>
          <th>Name</th>
          <th>Status</th>
          <th>Method</th>
          <th>Source</th>
          <th>Opt-In Date</th>
          <th>Pending Message</th>
          <th>Last Contact</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${contacts.map(contact => {
          let statusBadge = '';
          if (contact.opted_in) {
            statusBadge = '<span class="status-badge status-opted-in">✓ Opted In</span>';
          } else if (contact.opted_out) {
            statusBadge = '<span class="status-badge status-opted-out">✗ Opted Out</span>';
          } else {
            statusBadge = '<span class="status-badge status-pending">⏳ Pending</span>';
          }

          const methodBadge = contact.opt_in_method
            ? `<span class="method-badge">${escapeHtml(contact.opt_in_method.toUpperCase())}</span>`
            : '';

          const pendingMsg = contact.pending_message
            ? `<div class="pending-message" title="${escapeHtml(contact.pending_message)}">${escapeHtml(contact.pending_message)}</div>`
            : '<span class="timestamp">—</span>';

          const blockAction = contact.is_blocked
            ? `<button class="btn-unblock-contact contact-unblock-btn" data-phone="${escapeHtml(contact.phone_number)}">Unblock</button>`
            : `<button class="btn-block-contact contact-block-btn" data-phone="${escapeHtml(contact.phone_number)}">Block</button>`;

          const nameDisplay = contact.first_name
            ? `<span class="contact-name-display">${escapeHtml(contact.first_name)}</span>`
            : '<span style="color:#555">—</span>';
          const nameCell = `<td>${nameDisplay} <button class="edit-name-btn" data-phone="${escapeHtml(contact.phone_number)}" title="Edit name" onclick="editContactName(this)">✎</button></td>`;
          const sourceCell = `<td><span class="timestamp">${escapeHtml(contact.source || '—')}</span></td>`;

          return `
            <tr>
              <td><strong>${escapeHtml(formatPhone(contact.phone_number))}</strong></td>
              ${nameCell}
              <td>${statusBadge}</td>
              <td>${methodBadge || '<span class="timestamp">—</span>'}</td>
              ${sourceCell}
              <td><span class="timestamp">${formatTimestamp(contact.opt_in_timestamp)}</span></td>
              <td>${pendingMsg}</td>
              <td><span class="timestamp">${formatTimestamp(contact.last_message_timestamp)}</span></td>
              <td>${blockAction}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- Block Modal -->
  <div id="contactBlockModal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8);">
    <div style="background: #1a1a1a; border: 2px solid #E9407A; border-radius: 8px; padding: 30px; max-width: 500px; margin: 100px auto;">
      <h2 style="color: #FFC629; margin-bottom: 20px;">Block Phone Number</h2>
      <p>Phone: <span id="contactBlockPhoneDisplay" style="color: #2B9EB3; font-weight: 600;"></span></p>
      <label style="display: block; margin-top: 15px; color: #2B9EB3; font-weight: 600;">Reason (optional):</label>
      <select id="contactBlockReason" style="width: 100%; padding: 10px; background: #2B2B2B; border: 2px solid #2B9EB3; border-radius: 6px; color: white; margin-top: 5px;">
        <option value="">Select reason...</option>
        <option value="Inappropriate content">Inappropriate content</option>
        <option value="Spam">Spam</option>
        <option value="Harassment">Harassment</option>
        <option value="Other">Other</option>
      </select>
      <label style="display: block; margin-top: 15px; color: #2B9EB3; font-weight: 600;">Notes (optional):</label>
      <textarea id="contactBlockNotes" rows="3" style="width: 100%; padding: 10px; background: #2B2B2B; border: 2px solid #2B9EB3; border-radius: 6px; color: white; margin-top: 5px;"></textarea>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button style="flex: 1; padding: 12px; background: #dc2626; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;" id="contactConfirmBlock">Block Number</button>
        <button style="flex: 1; padding: 12px; background: #2B9EB3; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;" id="contactCancelBlock">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    // Auto-refresh every 30 seconds (skip while editing or importing)
    window.__editing = false;
    window.__importing = false;
    setTimeout(function() { if (!window.__editing && !window.__importing) location.reload(); }, 30000);

    // Inline name edit — direct onclick functions (more reliable than event delegation)
    function editContactName(btn) {
      var phone = btn.dataset.phone;
      var td = btn.parentElement;
      var current = td.querySelector('.contact-name-display');
      var currentName = current ? current.textContent : '';
      window.__editing = true;
      td.innerHTML =
        '<input type="text" class="name-edit-input" value="' + currentName.replace(/"/g, '&quot;') + '" maxlength="50"> ' +
        '<button class="btn-save-name" data-phone="' + phone.replace(/"/g, '&quot;') + '" onclick="saveContactName(this)">Save</button> ' +
        '<button class="btn-cancel-name" onclick="cancelNameEdit()">Cancel</button>';
      td.querySelector('.name-edit-input').focus();
    }

    function saveContactName(btn) {
      var phone = btn.dataset.phone;
      var td = btn.parentElement;
      var name = td.querySelector('.name-edit-input').value;
      fetch('/admin/contacts/' + encodeURIComponent(phone), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: name }),
        credentials: 'include'
      }).then(function(resp) {
        if (resp.ok) { window.__editing = false; location.reload(); }
        else { alert('Failed to save name'); }
      }).catch(function() { alert('Error saving name'); });
    }

    function cancelNameEdit() {
      window.__editing = false;
      location.reload();
    }

    // Add single contact
    document.getElementById('addContactBtn').addEventListener('click', async function() {
      var name = document.getElementById('addName').value.trim();
      var phone = document.getElementById('addPhone').value.trim();
      var source = document.getElementById('addSource').value.trim();
      var consented = document.querySelector('input[name="addConsent"]:checked').value === 'consented';
      var resultDiv = document.getElementById('addResult');
      if (!phone) { alert('Phone number is required'); return; }
      window.__importing = true;
      resultDiv.style.display = 'block';
      resultDiv.textContent = 'Adding...';
      try {
        var resp = await fetch('/admin/contacts/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contacts: [{ name: name, phone: phone }], consented: consented, source: source }),
          credentials: 'include'
        });
        var data = await resp.json();
        if (!resp.ok) {
          resultDiv.style.color = '#ef4444'; resultDiv.textContent = data.error || 'Error';
        } else if (data.invalid && data.invalid.length > 0) {
          resultDiv.style.color = '#ef4444'; resultDiv.textContent = 'Invalid phone: ' + data.invalid[0].reason;
        } else {
          resultDiv.style.color = '#4ade80';
          resultDiv.textContent = data.imported ? 'Contact added!' : (data.updated ? 'Contact updated.' : 'Contact already exists (skipped).');
          setTimeout(function() { location.reload(); }, 1000);
        }
      } catch (err) {
        resultDiv.style.color = '#ef4444'; resultDiv.textContent = 'Error adding contact';
      } finally { window.__importing = false; }
    });

    // CSV parsing
    function parseCSVRow(line) {
      var cols = [], cur = '', inQ = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (c === '"') {
          if (inQ && line[i+1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
        else { cur += c; }
      }
      cols.push(cur);
      return cols;
    }

    function parseCSV(text) {
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var lines = text.split(/\\r?\\n/).filter(function(l) { return l.trim(); });
      if (lines.length < 2) return [];
      var headers = parseCSVRow(lines[0]).map(function(h) { return h.trim().toLowerCase(); });
      var phoneIdx = headers.indexOf('phone');
      var nameIdx = headers.findIndex(function(h) { return h === 'name' || h === 'first name' || h === 'firstname'; });
      if (phoneIdx === -1) return null;
      var rows = [], seen = {};
      for (var i = 1; i < lines.length; i++) {
        var cols = parseCSVRow(lines[i]);
        var ph = (cols[phoneIdx] || '').trim();
        if (!ph || seen[ph]) continue;
        seen[ph] = true;
        rows.push({ phone: ph, name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '' });
      }
      return rows;
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    document.getElementById('importBtn').addEventListener('click', async function() {
      var file = document.getElementById('csvFile').files[0];
      if (!file) { alert('Select a CSV file first'); return; }
      var source = document.getElementById('csvSource').value.trim();
      var consented = document.getElementById('csvConsented').checked;
      var resultsDiv = document.getElementById('importResults');
      var text = await file.text();
      var rows = parseCSV(text);
      if (rows === null) {
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<span style="color:#ef4444">CSV must have a "phone" column header.</span>';
        return;
      }
      if (rows.length === 0) {
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<span style="color:#FFC629">No valid rows found in CSV.</span>';
        return;
      }
      if (!consented && rows.length > 500) {
        if (!confirm('This will send opt-in request SMS to ' + rows.length + ' phone numbers. Continue?')) return;
      }
      window.__importing = true;
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = '<span style="color:#aaa">Importing...</span>';
      var totalImported = 0, totalUpdated = 0, totalSkippedExisting = 0, totalSkippedPending = 0, totalSkippedOptedOut = 0, totalOptIn = 0;
      var allInvalid = [];
      for (var i = 0; i < rows.length; i += 200) {
        var batch = rows.slice(i, i + 200);
        try {
          var resp = await fetch('/admin/contacts/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contacts: batch, consented: consented, source: source }),
            credentials: 'include'
          });
          var data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Server error');
          totalImported += data.imported || 0;
          totalUpdated += data.updated || 0;
          totalSkippedExisting += data.skipped_existing || 0;
          totalSkippedPending += data.skipped_pending || 0;
          totalSkippedOptedOut += data.skipped_opted_out || 0;
          totalOptIn += data.optInRequestsQueued || 0;
          allInvalid = allInvalid.concat(data.invalid || []);
        } catch (err) {
          resultsDiv.innerHTML = '<span style="color:#ef4444">Import error: ' + escHtml(err.message) + '</span>';
          window.__importing = false; return;
        }
        resultsDiv.innerHTML = '<span style="color:#aaa">Processed ' + Math.min(i + 200, rows.length) + ' / ' + rows.length + '...</span>';
      }
      window.__importing = false;
      var html = '<div style="color:#4ade80;margin-bottom:8px;font-weight:600;">Import complete!</div>';
      html += '<div>Imported: ' + totalImported + ' | Updated: ' + totalUpdated;
      html += ' | Skipped (existing): ' + totalSkippedExisting;
      html += ' | Skipped (pending): ' + totalSkippedPending;
      html += ' | Skipped (opted-out): ' + totalSkippedOptedOut;
      if (totalOptIn) html += ' | Opt-in SMS queued: ' + totalOptIn;
      html += '</div>';
      if (allInvalid.length > 0) {
        html += '<div style="color:#ef4444;margin-top:8px;">Invalid (' + allInvalid.length + '):</div>';
        html += '<ul style="margin:4px 0 0 16px;color:#f87171;">';
        var shown = allInvalid.slice(0, 20);
        for (var j = 0; j < shown.length; j++) {
          html += '<li>' + escHtml(shown[j].raw || '') + ': ' + escHtml(shown[j].reason) + '</li>';
        }
        html += '</ul>';
        if (allInvalid.length > 20) html += '<div style="color:#888">...and ' + (allInvalid.length - 20) + ' more</div>';
      }
      resultsDiv.innerHTML = html;
      setTimeout(function() { location.reload(); }, 3000);
    });

    // Block button handler
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('contact-block-btn')) {
        const phone = e.target.dataset.phone;
        document.getElementById('contactBlockPhoneDisplay').textContent = phone;
        document.getElementById('contactBlockModal').style.display = 'block';
        document.getElementById('contactBlockModal').dataset.phone = phone;
      }
    });

    // Unblock button handler
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('contact-unblock-btn')) {
        const phone = e.target.dataset.phone;
        if (!confirm('Unblock this number? Future messages will appear in the DJ dashboard.')) return;
        try {
          const response = await fetch('/admin/blocked-numbers/' + encodeURIComponent(phone), {
            method: 'DELETE',
            credentials: 'include'
          });
          if (response.ok) {
            location.reload();
          } else {
            const data = await response.json();
            alert(data.error || 'Failed to unblock number');
          }
        } catch (error) {
          alert('Error unblocking number');
        }
      }
    });

    document.getElementById('contactCancelBlock').addEventListener('click', () => {
      document.getElementById('contactBlockModal').style.display = 'none';
      document.getElementById('contactBlockReason').value = '';
      document.getElementById('contactBlockNotes').value = '';
    });

    document.getElementById('contactConfirmBlock').addEventListener('click', async () => {
      const phone = document.getElementById('contactBlockModal').dataset.phone;
      const reason = document.getElementById('contactBlockReason').value;
      const notes = document.getElementById('contactBlockNotes').value;
      try {
        const response = await fetch('/admin/blocked-numbers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, reason, notes }),
          credentials: 'include'
        });
        if (response.ok) {
          document.getElementById('contactBlockModal').style.display = 'none';
          location.reload();
        } else {
          const data = await response.json();
          alert(data.error || 'Failed to block number');
        }
      } catch (error) {
        alert('Error blocking number');
      }
    });
  </script>
</body>
</html>
    `);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).send('Error loading contacts');
  }
});

module.exports = router;
