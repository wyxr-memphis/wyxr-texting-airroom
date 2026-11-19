// Who receives a broadcast.
//
// Single source of truth for the eligibility rule, shared by the recipient-count
// endpoint, the confirm handler, and anything added later — so the number staff
// are shown and the rows actually inserted can never drift apart.
//
// The rule (BROADCAST_MESSAGING_SPEC.md §3, §8.3):
//   - opted in, not opted out, not blocked
//   - opt_in_method IN ('sms','web','legacy') — the listener acted themselves
//
// 'sms'    listener texted in and replied YES (double opt-in)
// 'web'    listener submitted the opt-in form at wyxr.org/text
// 'legacy' backfilled from the messages table by migration 003 — these people
//          texted the station before the opt-in system existed, so their
//          consent rests on the inbound text itself (T&C §5.2) without a YES
//          confirmation. Included by station decision: they self-initiated
//          contact and are active listeners.
//
// 'import' contacts are excluded unconditionally. Their opted_in flag was set
// by a staff attestation at CSV import rather than by any action the listener
// took, and staff attestation appears nowhere in the consent flow registered
// with the carriers. There is deliberately no override: the remedy is to
// re-import without the attestation so the listener gets a confirmation text,
// which flips opt_in_method to 'sms' and makes them eligible automatically.
const pool = require('../config/database');

const ELIGIBLE_METHODS = ['sms', 'web', 'legacy'];

// Shared predicate. Kept as one string so the count and the insert cannot
// disagree about who is eligible.
const ELIGIBLE_WHERE = `
  c.opted_in = true
  AND c.opted_out = false
  AND c.opt_in_method = ANY($1)
  AND NOT EXISTS (
    SELECT 1 FROM blocked_numbers b WHERE b.phone = c.phone_number
  )
`;

/**
 * Live eligible-recipient breakdown. Never cached — staff act on this number.
 *
 * excludedImported is reported for transparency only, so the compose page can
 * explain why the total is lower than the contacts page's opted-in headline.
 * Nothing can pull those contacts into an actual send.
 */
const getListenerCounts = async () => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE}) AS eligible,
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE} AND c.opt_in_method = 'sms') AS sms,
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE} AND c.opt_in_method = 'web') AS web,
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE} AND c.opt_in_method = 'legacy') AS legacy,
       COUNT(*) FILTER (
         WHERE c.opted_in = true
           AND c.opted_out = false
           AND c.opt_in_method = 'import'
           AND NOT EXISTS (SELECT 1 FROM blocked_numbers b WHERE b.phone = c.phone_number)
       ) AS excluded_imported,
       -- Imported contacts already asked to re-confirm, waiting on a YES.
       COUNT(*) FILTER (
         WHERE c.opt_in_method = 'import'
           AND c.opted_in = false
           AND c.opted_out = false
           AND EXISTS (
             SELECT 1 FROM opt_in_log l
             WHERE l.phone_number = c.phone_number AND l.action_type = 'reconsent_request'
           )
       ) AS awaiting_reconsent
     FROM contacts c`,
    [ELIGIBLE_METHODS]
  );

  const row = rows[0];
  return {
    count: parseInt(row.eligible, 10),
    byMethod: {
      sms: parseInt(row.sms, 10),
      web: parseInt(row.web, 10),
      legacy: parseInt(row.legacy, 10)
    },
    excludedImported: parseInt(row.excluded_imported, 10),
    awaitingReconsent: parseInt(row.awaiting_reconsent, 10)
  };
};

/**
 * Snapshot the current eligible set into broadcast_recipients for a broadcast.
 *
 * Runs inside the caller's transaction (pass the client, not the pool) so the
 * snapshot and the broadcasts status flip commit together. ON CONFLICT DO
 * NOTHING makes a retry harmless: the UNIQUE (broadcast_id, phone_number)
 * constraint means a listener can never get two rows for one broadcast.
 */
const snapshotListeners = async (client, broadcastId) => {
  const { rowCount } = await client.query(
    `INSERT INTO broadcast_recipients (broadcast_id, phone_number, opt_in_method)
     SELECT $2, c.phone_number, c.opt_in_method
     FROM contacts c
     WHERE ${ELIGIBLE_WHERE}
     ON CONFLICT (broadcast_id, phone_number) DO NOTHING`,
    [ELIGIBLE_METHODS, broadcastId]
  );
  return rowCount;
};

// ---------------------------------------------------------------------------
// DJ audience (migration 007). Reads dj_roster only, never contacts.
//
// A DJ gets group texts when they are on the roster (active), signed up by
// texting DJ and replying YES (opted_in), have not replied STOP, and have a
// first AND last name on file. A blank or whitespace-only name excludes them:
// staff must know who every recipient is.
// ---------------------------------------------------------------------------
const DJ_HAS_NAME = `
  btrim(COALESCE(d.first_name, '')) <> ''
  AND btrim(COALESCE(d.last_name, '')) <> ''
`;

const DJ_SIGNED_UP = `
  d.active = true
  AND d.opted_in = true
  AND d.opted_out = false
`;

const DJ_ELIGIBLE_WHERE = `${DJ_SIGNED_UP} AND ${DJ_HAS_NAME}`;

/**
 * Live DJ count. missingName is signed-up DJs left out only because a first
 * or last name is blank; the compose page names that number.
 */
const getDjCounts = async () => {
  const { rows: [row] } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE ${DJ_ELIGIBLE_WHERE}) AS eligible,
       COUNT(*) FILTER (WHERE ${DJ_SIGNED_UP} AND NOT (${DJ_HAS_NAME})) AS missing_name,
       COUNT(*) FILTER (WHERE d.active = true AND d.opted_in = false AND d.opted_out = false) AS waiting,
       COUNT(*) FILTER (WHERE d.active = true AND d.opted_out = true) AS opted_out
     FROM dj_roster d`
  );
  return {
    count: parseInt(row.eligible, 10),
    missingName: parseInt(row.missing_name, 10),
    waiting: parseInt(row.waiting, 10),
    optedOut: parseInt(row.opted_out, 10)
  };
};

const snapshotDjs = async (client, broadcastId) => {
  const { rowCount } = await client.query(
    `INSERT INTO broadcast_recipients (broadcast_id, phone_number, opt_in_method)
     SELECT $1, d.phone_number, d.opt_in_method
     FROM dj_roster d
     WHERE ${DJ_ELIGIBLE_WHERE}
     ON CONFLICT (broadcast_id, phone_number) DO NOTHING`,
    [broadcastId]
  );
  return rowCount;
};

const AUDIENCES = ['listeners', 'djs'];

const assertAudience = (audience) => {
  if (!AUDIENCES.includes(audience)) {
    throw new Error(`Unknown broadcast audience: ${audience}`);
  }
};

/** Live recipient count for an audience. Defaults to listeners. */
const getRecipientCounts = async (audience = 'listeners') => {
  assertAudience(audience);
  return audience === 'djs' ? getDjCounts() : getListenerCounts();
};

/** Snapshot an audience into broadcast_recipients, inside the caller's transaction. */
const snapshotRecipients = async (client, broadcastId, audience = 'listeners') => {
  assertAudience(audience);
  return audience === 'djs'
    ? snapshotDjs(client, broadcastId)
    : snapshotListeners(client, broadcastId);
};

module.exports = {
  ELIGIBLE_METHODS,
  AUDIENCES,
  getRecipientCounts,
  snapshotRecipients
};
