const crypto = require('crypto');
const twilio = require('twilio');

// SMS_DRY_RUN=true: nothing reaches Twilio. sendSMS logs and returns a fake
// sid, listMessagesTo returns []. Used for every local run and test.
const isDryRun = () => process.env.SMS_DRY_RUN === 'true';

// In-memory record of dry-run traffic so tests can assert what would have
// been sent. `failures` maps a To number to a Twilio error code to simulate.
const dryRun = {
  outbox: [],
  listCalls: [],
  failures: new Map(),
  reset() {
    this.outbox.length = 0;
    this.listCalls.length = 0;
    this.failures.clear();
  }
};

// The client is created on first real use, so dry runs and tests never need
// (or touch) real credentials.
let client = null;
const getClient = () => {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('Refusing to call the real Twilio API under NODE_ENV=test (set SMS_DRY_RUN=true)');
  }
  if (!client) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
};

// Number DJ texts are sent from. Null means DJ sending is off. There is
// deliberately no fallback to TWILIO_PHONE_NUMBER: DJ texts must never go
// out on the listener campaign's number.
const djFromNumber = () => process.env.DJ_TWILIO_PHONE_NUMBER || null;

// Automated message templates (TCPA/A2P compliant)
const MESSAGES = {
  OPT_IN_REQUEST: "WYXR 91.7 FM: You've requested msgs from WYXR. Reply YES to confirm. Msg freq varies. Msg&data rates may apply. STOP to opt out. Help: wyxr.org/privacy-policy/",
  OPT_IN_CONFIRMATION: "WYXR 91.7 FM: Welcome! You're now connected with our DJs. Text song requests anytime during live shows. Reply STOP to opt out. Msg&data rates may apply. Privacy: wyxr.org/privacy-policy/",
  OPT_IN_REMINDER: 'Hey! To chat with WYXR DJs, please reply YES to confirm. Thanks!',
  OPT_OUT_CONFIRMATION: "WYXR 91.7 FM: You're unsubscribed. No more messages will be sent. You can still listen at wyxr.org! Reply START to rejoin anytime.",
  ALREADY_OPTED_IN: "You're all set! You're already receiving WYXR messages.",
  HELP_RESPONSE: 'WYXR 91.7 FM: Text us to chat with DJs! Reply STOP to opt out. Questions? Visit wyxr.org or call the studio.',

  // DJ line (DJ_TWILIO_PHONE_NUMBER) - wording registered with the DJ campaign
  DJ_OPT_IN_REQUEST: 'WYXR 91.7 FM DJs: Reply YES to get station texts for DJs. Msg freq varies. Msg&data rates may apply. STOP to opt out.',
  DJ_OPT_IN_CONFIRMATION: "WYXR 91.7 FM DJs: You're signed up for station texts for DJs. Msg freq varies. Msg&data rates may apply. Reply HELP for help, STOP to opt out.",
  DJ_NAME_REQUEST: 'WYXR 91.7 FM DJs: One more step. Reply with your first and last name so staff know who you are.',
  DJ_NAME_THANKS: "WYXR 91.7 FM DJs: Thanks, you're all set.",
  DJ_NOT_ON_ROSTER: 'This line is for WYXR DJs. Ask station staff to add you.'
};

const sendSMS = async (to, message, { from } = {}) => {
  const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;
  if (isDryRun()) {
    const failCode = dryRun.failures.get(to);
    if (failCode) {
      const err = new Error(`Dry-run simulated Twilio error ${failCode}`);
      err.code = failCode;
      throw err;
    }
    const sid = 'SMdryrun' + crypto.randomBytes(12).toString('hex');
    dryRun.outbox.push({ sid, to, from: fromNumber, body: message, at: new Date() });
    console.log(`[sms-dry-run] ${fromNumber} -> ${to}: ${message}`);
    return { sid };
  }
  try {
    const result = await getClient().messages.create({
      body: message,
      from: fromNumber,
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
const listMessagesTo = async (to, dateSentAfter, limit = 20, { from } = {}) => {
  const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;
  if (isDryRun()) {
    dryRun.listCalls.push({ to, from: fromNumber, dateSentAfter, limit });
    return [];
  }
  return getClient().messages.list({
    to,
    from: fromNumber,
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
  djFromNumber,
  dryRun,
  MESSAGES
};
