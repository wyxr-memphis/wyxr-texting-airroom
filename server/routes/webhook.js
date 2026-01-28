const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// POST /webhook/sms - Twilio incoming SMS webhook
router.post('/sms', express.urlencoded({ extended: false }), async (req, res) => {
  const { From, Body } = req.body;

  console.log('Incoming SMS:', { from: From, body: Body });

  try {
    // Save message to database
    const result = await pool.query(
      `INSERT INTO messages (phone, text, timestamp)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [From, Body]
    );

    const message = result.rows[0];

    // Broadcast to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('message:new', message);
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
