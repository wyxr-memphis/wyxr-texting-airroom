// Who receives a broadcast.
//
// Single source of truth for the eligibility rule, shared by the recipient-count
// endpoint, the confirm handler, and anything added later — so the number staff
// are shown and the rows actually inserted can never drift apart.
//
// The rule (BROADCAST_MESSAGING_SPEC.md §3, §8.3):
//   - opted in, not opted out, not blocked
//   - opt_in_method IN ('sms','web') — the listener opted in themselves
//
// 'import' contacts are excluded unconditionally. Their opted_in flag was set
// by a staff attestation at CSV import rather than by any action the listener
// took, and staff attestation appears nowhere in the consent flow registered
// with the carriers. There is deliberately no override: the remedy is to
// re-import without the attestation so the listener gets a confirmation text,
// which flips opt_in_method to 'sms' and makes them eligible automatically.
const pool = require('../config/database');

const ELIGIBLE_METHODS = ['sms', 'web'];

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
const getRecipientCounts = async () => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE}) AS eligible,
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE} AND c.opt_in_method = 'sms') AS sms,
       COUNT(*) FILTER (WHERE ${ELIGIBLE_WHERE} AND c.opt_in_method = 'web') AS web,
       COUNT(*) FILTER (
         WHERE c.opted_in = true
           AND c.opted_out = false
           AND c.opt_in_method = 'import'
           AND NOT EXISTS (SELECT 1 FROM blocked_numbers b WHERE b.phone = c.phone_number)
       ) AS excluded_imported
     FROM contacts c`,
    [ELIGIBLE_METHODS]
  );

  const row = rows[0];
  return {
    count: parseInt(row.eligible, 10),
    byMethod: {
      sms: parseInt(row.sms, 10),
      web: parseInt(row.web, 10)
    },
    excludedImported: parseInt(row.excluded_imported, 10)
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
const snapshotRecipients = async (client, broadcastId) => {
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

module.exports = {
  ELIGIBLE_METHODS,
  getRecipientCounts,
  snapshotRecipients
};
