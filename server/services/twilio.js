const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Automated message templates (TCPA/A2P compliant)
const MESSAGES = {
  OPT_IN_REQUEST: 'Welcome to WYXR 91.7 FM! To chat with our DJs and get show updates, reply YES to confirm. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out, HELP for help. Privacy: wyxr.org/privacy',
  OPT_IN_CONFIRMATION: "You're all set! Our DJs can now respond to your texts. You'll also get program updates & community alerts from WYXR 91.7 FM. Msg frequency varies. Reply STOP anytime to opt out. wyxr.org",
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

module.exports = {
  sendSMS,
  sendOptInRequest,
  sendOptInConfirmation,
  sendOptInReminder,
  sendOptOutConfirmation,
  sendAlreadyOptedIn,
  sendHelpResponse,
  MESSAGES
};
