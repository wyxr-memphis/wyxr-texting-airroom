const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/settings/messaging-enabled
router.get('/settings/messaging-enabled', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = 'messaging_enabled'"
    );

    if (result.rows.length === 0) {
      return res.json({ enabled: true }); // Default to enabled
    }

    const enabled = result.rows[0].value === 'true';
    res.json({ enabled });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST /api/settings/messaging-enabled
router.post('/settings/messaging-enabled', requireAuth, async (req, res) => {
  const { enabled } = req.body;

  try {
    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ('messaging_enabled', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [enabled ? 'true' : 'false']
    );

    // Broadcast update to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('settings:updated', { messagingEnabled: enabled });
    }

    res.json({ enabled });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
