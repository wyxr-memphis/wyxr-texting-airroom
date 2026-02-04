const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// POST /webhook/sms - Twilio incoming SMS webhook
router.post('/sms', express.urlencoded({ extended: false }), async (req, res) => {
  const { From, Body } = req.body;

  console.log('Incoming SMS:', { from: From, body: Body });

  try {
    // Check if phone number is blocked
    const blockCheck = await pool.query(
      'SELECT phone FROM blocked_numbers WHERE phone = $1',
      [From]
    );
    const isBlocked = blockCheck.rows.length > 0;

    // Save message to database (always store for staff review)
    const result = await pool.query(
      `INSERT INTO messages (phone, text, timestamp)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [From, Body]
    );

    const message = result.rows[0];

    // Broadcast to DJs only if not blocked
    if (!isBlocked) {
      const io = req.app.get('io');
      if (io) {
        io.emit('message:new', message);
      }
      console.log('Message broadcast to DJs');
    } else {
      console.log('Message blocked - stored in DB but not broadcast to DJs');
    }

    // Return empty TwiML response
    res.type('text/xml');
    res.send('<Response></Response>');
  } catch (error) {
    console.error('Error processing incoming SMS:', error);
    res.type('text/xml');
    res.send('<Response></Response>');
  }
});

module.exports = router;
