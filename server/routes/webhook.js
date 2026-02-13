const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { sendSMS } = require('../services/twilio');

// Confirmation keywords (case-insensitive)
const CONFIRM_KEYWORDS = ['yes', 'y', 'confirm', 'ok', 'sure'];

const OPT_IN_CONFIRMATION = "You're all set! Our DJs can now respond to your texts. You'll also get program updates & community alerts from WYXR 91.7 FM. Msg frequency varies. Reply STOP anytime to opt out. wyxr.org";

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

    // Check for pending web opt-in confirmation
    const contactCheck = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1',
      [From]
    );

    if (contactCheck.rows.length > 0) {
      const contact = contactCheck.rows[0];

      // Pending opt-in: not yet confirmed, not opted out
      if (!contact.opted_in && !contact.opted_out) {
        const normalizedBody = (Body || '').trim().toLowerCase();

        if (CONFIRM_KEYWORDS.includes(normalizedBody)) {
          // Confirm opt-in
          await pool.query(
            `UPDATE contacts
             SET opted_in = true, opt_in_timestamp = NOW(), last_message_timestamp = NOW()
             WHERE phone_number = $1`,
            [From]
          );

          await pool.query(
            `INSERT INTO opt_in_log (phone_number, action_type, method, user_message, system_response)
             VALUES ($1, 'sms_confirm', 'sms', $2, $3)`,
            [From, Body, OPT_IN_CONFIRMATION]
          );

          try {
            await sendSMS(From, OPT_IN_CONFIRMATION);
          } catch (smsError) {
            console.error('Error sending opt-in confirmation SMS:', smsError);
          }

          console.log('Web opt-in confirmed for:', From);
        }
      }

      // Update last_message_timestamp for all known contacts
      await pool.query(
        'UPDATE contacts SET last_message_timestamp = NOW() WHERE phone_number = $1',
        [From]
      );
    }

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
