const crypto = require('crypto');

// Hash both sides so the buffers are always the same length, then compare in
// constant time — avoids the timing side-channel of a plain === comparison.
function timingSafeMatch(supplied, expected) {
  const a = crypto.createHash('sha256').update(String(supplied)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Shared credential check for /api/login and /admin/login.
function verifyCredentials(username, password) {
  const expectedUser = process.env.AUTH_USERNAME;
  const expectedPass = process.env.AUTH_PASSWORD;
  // Refuse all logins if credentials aren't configured rather than
  // accepting empty strings.
  if (!expectedUser || !expectedPass) return false;
  const userOk = timingSafeMatch(username || '', expectedUser);
  const passOk = timingSafeMatch(password || '', expectedPass);
  return userOk && passOk;
}

module.exports = { verifyCredentials };
