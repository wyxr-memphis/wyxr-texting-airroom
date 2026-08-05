const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Automated message templates (TCPA/A2P compliant)
const MESSAGES = {
  OPT_IN_REQUEST: "WYXR 91.7 FM: You've requested msgs from WYXR. Reply YES to confirm. Msg freq varies. Msg&data rates may apply. STOP to opt out. Help: wyxr.org/privacy-policy/",
  OPT_IN_CONFIRMATION: "WYXR 91.7 FM: Welcome! You're now connected with our DJs. Text song requests anytime during live shows. Reply STOP to opt out. Msg&data rates may apply. Privacy: wyxr.org/privacy-policy/",
  OPT_IN_REMINDER: 'Hey! To chat with WYXR DJs, please reply YES to confirm. Thanks!',
  OPT_OUT_CONFIRMATION: "WYXR 91.7 FM: You're unsubscribed. No more messages will be sent. You can still listen at wyxr.org! Reply START to rejoin anytime.",
  ALREADY_OPTED_IN: "You're all set! You're already receiving WYXR messages.",
  HELP_RESPONSE: 'WYXR 91.7 FM: Text us to chat with DJs! Reply STOP to opt out. Questions? Visit wyxr.org or call the studio.'
};

const sendSMS = async (to, message) => {
  try {
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    console.log('SMS sent:', result.sid);
    return result;
  } catch (error) {
    console.error('Error sending SMS:', error);
    // Log A2P errors but don't crash
    if (error.code === 21408 || error.code === 21610) {
      console.warn('A2P approval required - message not sent but logged');
    }
    throw error;
  }
};

// Send automated opt-in request (will fail until A2P approved)
const sendOptInRequest = async (to) => {
  try {
    return await sendSMS(to, MESSAGES.OPT_IN_REQUEST);
  } catch (error) {
    console.error('Opt-in request failed (waiting for A2P approval):', error.message);
    return null; // Continue processing even if send fails
  }
};

// Send opt-in confirmation (will fail until A2P approved)
const sendOptInConfirmation = async (to) => {
  try {
    return await sendSMS(to, MESSAGES.OPT_IN_CONFIRMATION);
  } catch (error) {
    console.error('Opt-in confirmation failed (waiting for A2P approval):', error.message);
    return null;
  }
};

// Send opt-in reminder (will fail until A2P approved)
const sendOptInReminder = async (to) => {
  try {
    return await sendSMS(to, MESSAGES.OPT_IN_REMINDER);
  } catch (error) {
    console.error('Opt-in reminder failed (waiting for A2P approval):', error.message);
    return null;
  }
};

// Send opt-out confirmation (will fail until A2P approved)
const sendOptOutConfirmation = async (to) => {
  try {
    return await sendSMS(to, MESSAGES.OPT_OUT_CONFIRMATION);
  } catch (error) {
    console.error('Opt-out confirmation failed (waiting for A2P approval):', error.message);
    return null;
  }
};

// Send already opted-in message (will fail until A2P approved)
const sendAlreadyOptedIn = async (to) => {
  try {
    return await sendSMS(to, MESSAGES.ALREADY_OPTED_IN);
  } catch (error) {
    console.error('Already opted-in message failed (waiting for A2P approval):', error.message);
    return null;
  }
};

// Send help response (will fail until A2P approved)
const sendHelpResponse = async (to) => {
  try {
    return await sendSMS(to, MESSAGES.HELP_RESPONSE);
  } catch (error) {
    console.error('Help response failed (waiting for A2P approval):', error.message);
    return null;
  }
};

// Look up messages we've already sent to a number since a given time.
//
// Used by the broadcast worker's crash recovery: if the process dies in the
// window between Twilio accepting a message and our DB recording it, the row
// is stuck at status='sending' even though the text went out. Asking Twilio
// what it actually sent is the only way to tell those apart, and it's what
// prevents a double-text on resume. See BROADCAST_MESSAGING_SPEC.md §7.5.
const listMessagesTo = async (to, dateSentAfter, limit = 20) => {
  return client.messages.list({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    dateSentAfter,
    limit
  });
};

module.exports = {
  sendSMS,
  sendOptInRequest,
  sendOptInConfirmation,
  sendOptInReminder,
  sendOptOutConfirmation,
  sendAlreadyOptedIn,
  sendHelpResponse,
  listMessagesTo,
  MESSAGES
};
