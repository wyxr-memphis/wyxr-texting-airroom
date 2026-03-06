const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const twilioService = require('../services/twilio');

// Keyword detection helpers
const isYesKeyword = (text) => {
  const normalized = text.trim().toLowerCase();
  return ['yes', 'y', 'confirm', 'ok', 'sure', 'start'].includes(normalized);
};

const isStopKeyword = (text) => {
  return ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke'].includes(text.trim().toLowerCase());
};

const isHelpKeyword = (text) => {
  return ['help', 'info'].includes(text.trim().toLowerCase());
};

// Log opt-in action to audit log
const logOptInAction = async (phone, actionType, method, userMessage, systemResponse) => {
  try {
    await pool.query(
      `INSERT INTO opt_in_log (phone_number, action_type, method, user_message, system_response)
       VALUES ($1, $2, $3, $4, $5)`,
      [phone, actionType, method, userMessage, systemResponse]
    );
  } catch (error) {
    console.error('Error logging opt-in action:', error);
  }
};

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

    // Always save message to database for staff review
    const messageResult = await pool.query(
      `INSERT INTO messages (phone, text, timestamp)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [From, Body]
    );
    const message = messageResult.rows[0];

    // If blocked, don't process further
    if (isBlocked) {
      console.log('Message blocked - stored in DB but not broadcast to DJs');
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }

    // Check contact opt-in status
    const contactResult = await pool.query(
      'SELECT * FROM contacts WHERE phone_number = $1',
      [From]
    );

    // Handle STOP keyword (always respected, even if not opted in)
    if (isStopKeyword(Body)) {
      if (contactResult.rows.length > 0) {
        await pool.query(
          `UPDATE contacts
           SET opted_out = true, opted_out_timestamp = NOW(), opted_in = false
           WHERE phone_number = $1`,
          [From]
        );
      } else {
        await pool.query(
          `INSERT INTO contacts (phone_number, opted_out, opted_out_timestamp)
           VALUES ($1, true, NOW())`,
          [From]
        );
      }
      // Twilio automatically sends opt-out confirmation for STOP keywords - do not send manually
      await logOptInAction(From, 'opt_out', 'sms', Body, twilioService.MESSAGES.OPT_OUT_CONFIRMATION);
      console.log('Contact opted out:', From);
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }

    // Handle HELP keyword
    if (isHelpKeyword(Body)) {
      // Twilio automatically sends help response for HELP/INFO keywords - do not send manually
      await logOptInAction(From, 'help_request', 'sms', Body, twilioService.MESSAGES.HELP_RESPONSE);
      console.log('Help response sent to:', From);
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }

    // NEW CONTACT - First time texting
    if (contactResult.rows.length === 0) {
      // Create contact with pending status
      await pool.query(
        `INSERT INTO contacts
         (phone_number, opted_in, pending_message, pending_timestamp, first_contact_timestamp, last_message_timestamp)
         VALUES ($1, false, $2, NOW(), NOW(), NOW())`,
        [From, Body]
      );

      // Send opt-in request (will fail until A2P approved but logged)
      await twilioService.sendOptInRequest(From);
      await logOptInAction(From, 'request', 'sms', Body, twilioService.MESSAGES.OPT_IN_REQUEST);

      console.log('New contact - opt-in request sent (pending A2P):', From);

      // Don't broadcast to DJs yet - waiting for opt-in
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }

    const contact = contactResult.rows[0];

    // OPTED-IN CONTACT - Forward to DJs
    if (contact.opted_in) {
      // Update last message timestamp
      await pool.query(
        'UPDATE contacts SET last_message_timestamp = NOW() WHERE phone_number = $1',
        [From]
      );

      // Handle YES when already opted in
      if (isYesKeyword(Body)) {
        await twilioService.sendAlreadyOptedIn(From);
        await logOptInAction(From, 'already_opted_in', 'sms', Body, twilioService.MESSAGES.ALREADY_OPTED_IN);
      }

      // Broadcast to DJs
      const io = req.app.get('io');
      if (io) {
        io.emit('message:new', message);
      }
      console.log('Message broadcast to DJs (opted-in contact)');
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }

    // PENDING CONTACT - Waiting for opt-in confirmation
    if (!contact.opted_in && !contact.opted_out) {
      // Check for YES confirmation
      if (isYesKeyword(Body)) {
        // Mark as opted-in
        await pool.query(
          `UPDATE contacts
           SET opted_in = true,
               opt_in_method = 'sms',
               opt_in_timestamp = NOW(),
               last_message_timestamp = NOW()
           WHERE phone_number = $1`,
          [From]
        );

        // Send confirmation
        await twilioService.sendOptInConfirmation(From);
        await logOptInAction(From, 'confirm', 'sms', Body, twilioService.MESSAGES.OPT_IN_CONFIRMATION);

        // Forward original pending message to DJs if it exists
        if (contact.pending_message) {
          const originalMessage = await pool.query(
            `SELECT * FROM messages
             WHERE phone = $1 AND text = $2
             ORDER BY timestamp DESC LIMIT 1`,
            [From, contact.pending_message]
          );

          if (originalMessage.rows.length > 0) {
            const io = req.app.get('io');
            if (io) {
              io.emit('message:new', originalMessage.rows[0]);
            }
            console.log('Original pending message forwarded to DJs:', contact.pending_message);
          }
        }

        // Clear pending message
        await pool.query(
          'UPDATE contacts SET pending_message = NULL, pending_timestamp = NULL WHERE phone_number = $1',
          [From]
        );

        console.log('Contact opted in successfully:', From);
        res.type('text/xml');
        res.send('<Response></Response>');
        return;
      }

      // Different message while pending - update pending message and send reminder
      await pool.query(
        `UPDATE contacts
         SET pending_message = $1, pending_timestamp = NOW(), last_message_timestamp = NOW()
         WHERE phone_number = $2`,
        [Body, From]
      );

      await twilioService.sendOptInReminder(From);
      await logOptInAction(From, 'reminder', 'sms', Body, twilioService.MESSAGES.OPT_IN_REMINDER);

      console.log('Pending contact - reminder sent:', From);
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }

    // OPTED-OUT CONTACT - Don't send anything
    if (contact.opted_out) {
      console.log('Message from opted-out contact - not processed:', From);
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
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
