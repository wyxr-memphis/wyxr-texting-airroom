const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /admin/messages - View all messages (admin interface)
router.get('/messages', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, phone, text, timestamp, read, replied, reply_text, replied_at, created_at
      FROM messages
      ORDER BY timestamp DESC
    `);

    const messages = result.rows;

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
    <h1>WYXR 91.7 FM</h1>
    <p>Message History - Admin Panel</p>
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

  <div class="controls">
    <input type="text" id="searchBox" class="search-box" placeholder="Search messages or phone numbers...">
    <a href="/" class="btn btn-primary">← Back to App</a>
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
              <td class="phone">${formatPhone(msg.phone)}</td>
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
                <button class="btn btn-danger delete-btn" data-id="${msg.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <script>
    // Search functionality
    const searchBox = document.getElementById('searchBox');
    const table = document.getElementById('messagesTable');

    if (searchBox && table) {
      searchBox.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
      });
    }

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

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = router;
