// SMS text measurement for broadcasts.
//
// Twilio bills per segment per recipient, so a body that crosses a segment
// boundary doubles the cost of a whole send. The compose page shows these
// numbers live (and the server recomputes them at confirm time) specifically
// so staff see the boundary before confirming rather than after the bill.
//
// See BROADCAST_MESSAGING_SPEC.md §8.1 and §8.4.

// Appended to every broadcast body, server-side, with no way to omit it.
const COMPLIANCE_SUFFIX = ' Reply STOP to opt out.';

// GSM 03.38 basic character set. Anything outside this (plus the extension
// table below) forces the whole message into UCS-2, cutting the per-segment
// budget from 160 to 70 characters.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

// These are representable in GSM-7 but require an escape byte, so each one
// costs TWO characters of budget even though it renders as one glyph.
const GSM7_EXTENDED = '^{}\\[~]|€';

const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED);

const isGsm7 = (text) =>
  [...text].every((ch) => GSM7_BASIC_SET.has(ch) || GSM7_EXTENDED_SET.has(ch));

// Cost in GSM-7 "characters" — extended chars count double (escape sequence).
const gsm7Length = (text) =>
  [...text].reduce((sum, ch) => sum + (GSM7_EXTENDED_SET.has(ch) ? 2 : 1), 0);

/**
 * Measure a full outgoing message (body + suffix already combined).
 *
 * Single-segment budgets are 160 (GSM-7) / 70 (UCS-2). Once a message needs
 * splitting, concatenation headers eat into every segment, dropping them to
 * 153 / 67 respectively — so a 161-character GSM-7 message is 2 segments,
 * not "1 plus a bit".
 */
const measure = (fullText) => {
  const text = fullText || '';
  const gsm7 = isGsm7(text);

  // UCS-2 budgets are counted in UTF-16 code units, which is what the carrier
  // actually pays for — an emoji outside the BMP is a surrogate pair, i.e. 2.
  const length = gsm7 ? gsm7Length(text) : text.length;
  const [single, multi] = gsm7 ? [160, 153] : [70, 67];

  let segmentCount;
  if (length === 0) {
    segmentCount = 0;
  } else if (length <= single) {
    segmentCount = 1;
  } else {
    segmentCount = Math.ceil(length / multi);
  }

  return {
    characterCount: length,
    segmentCount,
    encoding: gsm7 ? 'GSM-7' : 'UCS-2',
    singleSegmentLimit: single,
    multiSegmentLimit: multi
  };
};

/** The exact text that goes on the wire for a broadcast body. */
const fullTextFor = (body) => `${(body || '').trim()}${COMPLIANCE_SUFFIX}`;

// Public URL shorteners draw carrier filtering because they hide the
// destination. Not blocked — surfaced as a compose-page warning (spec §9.1).
const SHORTENER_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly'
];

const findShorteners = (text) => {
  const lower = (text || '').toLowerCase();
  return SHORTENER_DOMAINS.filter((domain) => lower.includes(domain));
};

module.exports = {
  COMPLIANCE_SUFFIX,
  measure,
  fullTextFor,
  findShorteners,
  SHORTENER_DOMAINS
};
