const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/messages - Get messages from last 2 hours (excluding blocked numbers, including opt-in status)
router.get('/messages', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         m.*,
         c.opted_in,
         c.opted_out,
         c.pending_message,
         c.opt_in_method
       FROM messages m
       LEFT JOIN contacts c ON m.phone = c.phone_number
       WHERE m.timestamp >= NOW() - INTERVAL '2 hours'
       AND NOT EXISTS (
         SELECT 1 FROM blocked_numbers b WHERE b.phone = m.phone
       )
       ORDER BY m.timestamp DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// PATCH /api/messages/:id/read - Toggle read status
router.patch('/messages/:id/read', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { read } = req.body;

  try {
    const result = await pool.query(
      `WITH updated AS (UPDATE messages SET read = $1 WHERE id = $2 RETURNING *)
       SELECT u.*, c.opted_in, c.opted_out FROM updated u
       LEFT JOIN contacts c ON u.phone = c.phone_number`,
      [read, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = result.rows[0];

    // Broadcast update to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('message:updated', message);
    }

    res.json(message);
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// POST /api/messages/:id/reply - Send reply via SMS
router.post('/messages/:id/reply', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { replyText } = req.body;

  if (!replyText || replyText.trim() === '') {
    return res.status(400).json({ error: 'Reply text is required' });
  }

  try {
    // Get the message
    const messageResult = await pool.query(
      'SELECT * FROM messages WHERE id = $1',
      [id]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messageResult.rows[0];

    // Verify contact is opted-in before sending reply
    const contactResult = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1',
      [message.phone]
    );

    if (contactResult.rows.length === 0) {
      return res.status(403).json({
        error: 'Cannot reply: Contact has not opted in yet. Waiting for listener to confirm opt-in.'
      });
    }

    const contact = contactResult.rows[0];

    if (!contact.opted_in) {
      return res.status(403).json({
        error: 'Cannot reply: Contact has not opted in yet. Waiting for listener to confirm opt-in.'
      });
    }

    if (contact.opted_out) {
      return res.status(403).json({
        error: 'Cannot reply: Contact has opted out of receiving messages.'
      });
    }

    // Send SMS via Twilio
    const twilioService = require('../services/twilio');
    await twilioService.sendSMS(message.phone, replyText);

    // Update message as replied and mark as read
    const updateResult = await pool.query(
      `WITH updated AS (
         UPDATE messages SET replied = true, reply_text = $1, replied_at = NOW(), read = true
         WHERE id = $2 RETURNING *
       )
       SELECT u.*, c.opted_in, c.opted_out FROM updated u
       LEFT JOIN contacts c ON u.phone = c.phone_number`,
      [replyText, id]
    );

    const updatedMessage = updateResult.rows[0];

    // Update contact last message timestamp
    await pool.query(
      'UPDATE contacts SET last_message_timestamp = NOW() WHERE phone_number = $1',
      [message.phone]
    );

    // Broadcast update to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('message:updated', updatedMessage);
    }

    res.json(updatedMessage);
  } catch (error) {
    console.error('Error sending reply:', error);
    res.status(500).json({ error: 'Failed to send reply: ' + error.message });
  }
});

module.exports = router;
