const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { sendSMS } = require('../services/twilio');
const rateLimit = require('express-rate-limit');

// Rate limiter: 5 opt-in requests per IP per 15 minutes
const optInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Please try again later.' }
});

const OPT_IN_REQUEST = 'Welcome to WYXR 91.7 FM! To chat with our DJs and get show updates, reply YES to confirm. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out, HELP for help. Privacy: wyxr.org/privacy';

// POST /api/sms/web-opt-in - Public endpoint for website opt-in form
router.post('/web-opt-in', optInLimiter, async (req, res) => {
  const { first_name, phone_number, consent, consent_text, source_url } = req.body;

  // Validate first_name
  if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0 || first_name.trim().length > 50) {
    return res.status(400).json({ status: 'error', message: 'First name is required (1-50 characters)' });
  }

  // Validate phone_number: E.164 US format +1XXXXXXXXXX
  const phoneRegex = /^\+1[2-9]\d{9}$/;
  if (!phone_number || !phoneRegex.test(phone_number)) {
    return res.status(400).json({ status: 'error', message: 'Valid US phone number required' });
  }

  // Validate consent
  if (consent !== true) {
    return res.status(400).json({ status: 'error', message: 'Consent is required' });
  }

  const trimmedName = first_name.trim();
  const ip_address = req.ip || req.connection.remoteAddress;

  try {
    // Check if contact already exists
    const existing = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1',
      [phone_number]
    );

    if (existing.rows.length > 0) {
      const contact = existing.rows[0];

      if (contact.opted_in) {
        return res.json({
          status: 'already_opted_in',
          message: 'This number is already signed up.',
          phone_number
        });
      }

      if (contact.opted_out) {
        // Previously opted out - reset for re-opt-in
        await pool.query(
          `UPDATE contacts
           SET opted_out = false, opted_out_timestamp = NULL,
               first_name = $1, opt_in_method = 'web',
               pending_message = NULL, pending_timestamp = NULL,
               last_message_timestamp = NOW()
           WHERE phone_number = $2`,
          [trimmedName, phone_number]
        );

        await pool.query(
          `INSERT INTO opt_in_log (phone_number, action_type, method, system_response, ip_address, consent_text, source_url)
           VALUES ($1, 'web_opt_in_request', 'web', $2, $3, $4, $5)`,
          [phone_number, OPT_IN_REQUEST, ip_address, consent_text || null, source_url || null]
        );

        await sendSMS(phone_number, OPT_IN_REQUEST);

        return res.json({
          status: 'ok',
          message: 'Confirmation SMS sent',
          phone_number
        });
      }

      // Pending (opted_in=false, not opted_out)
      return res.json({
        status: 'pending',
        message: 'Confirmation already sent, awaiting YES reply',
        phone_number
      });
    }

    // New contact
    await pool.query(
      `INSERT INTO contacts (phone_number, first_name, opted_in, opt_in_method, last_message_timestamp)
       VALUES ($1, $2, false, 'web', NOW())`,
      [phone_number, trimmedName]
    );

    await pool.query(
      `INSERT INTO opt_in_log (phone_number, action_type, method, system_response, ip_address, consent_text, source_url)
       VALUES ($1, 'web_opt_in_request', 'web', $2, $3, $4, $5)`,
      [phone_number, OPT_IN_REQUEST, ip_address, consent_text || null, source_url || null]
    );

    await sendSMS(phone_number, OPT_IN_REQUEST);

    return res.json({
      status: 'ok',
      message: 'Confirmation SMS sent',
      phone_number
    });
  } catch (error) {
    console.error('Error processing web opt-in:', error);
    return res.status(500).json({ status: 'error', message: 'An error occurred. Please try again.' });
  }
});

module.exports = router;
