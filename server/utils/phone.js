function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  let e164;
  if (digits.length === 10) {
    e164 = '+1' + digits;
  } else if (digits.length === 11 && digits[0] === '1') {
    e164 = '+' + digits;
  } else {
    return null;
  }
  if (!/^\+1[2-9]\d{9}$/.test(e164)) return null;
  return e164;
}

module.exports = { normalizePhone };
