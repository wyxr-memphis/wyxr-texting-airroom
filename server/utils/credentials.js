const crypto = require('crypto');

// Hash both sides so the buffers are always the same length, then compare in
// constant time — avoids the timing side-channel of a plain === comparison.
function timingSafeMatch(supplied, expected) {
  const a = crypto.createHash('sha256').update(String(supplied)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

const matches = (username, password, expectedUser, expectedPass) => {
  // Refuse a login pair that isn't configured rather than accepting empty
  // strings.
  if (!expectedUser || !expectedPass) return false;
  const userOk = timingSafeMatch(username || '', expectedUser);
  const passOk = timingSafeMatch(password || '', expectedPass);
  return userOk && passOk;
};

/**
 * Shared credential check for /api/login and /admin/login.
 *
 * Returns 'staff' (STAFF_USERNAME/STAFF_PASSWORD — DJ roster, DJ broadcasts,
 * Slack relay), 'dj' (the shared AUTH_USERNAME/AUTH_PASSWORD login), or null.
 * Staff is checked first. With STAFF_* unset no staff login is possible.
 */
function verifyCredentials(username, password) {
  if (matches(username, password, process.env.STAFF_USERNAME, process.env.STAFF_PASSWORD)) {
    return 'staff';
  }
  if (matches(username, password, process.env.AUTH_USERNAME, process.env.AUTH_PASSWORD)) {
    return 'dj';
  }
  return null;
}

/**
 * Called at startup. If the staff username equalled the shared one, which
 * role a login gets would come down to the password alone, and a shared-login
 * user could be one typo away from staff access. Refuse to start instead.
 */
function assertCredentialConfig() {
  const staffUser = process.env.STAFF_USERNAME;
  if (staffUser && staffUser === process.env.AUTH_USERNAME) {
    throw new Error('STAFF_USERNAME must be different from AUTH_USERNAME. Refusing to start.');
  }
}

module.exports = { verifyCredentials, assertCredentialConfig };
