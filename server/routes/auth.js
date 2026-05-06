const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Generate a signed WebSocket token from a session ID.
// Allows the client to auth the socket directly with Render without needing
// the session cookie (which lives on the Vercel domain, not Render's).
function makeWsToken(sessionId) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sessionId)
    .digest('hex');
  return `${sessionId}.${sig}`;
}

// POST /api/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.AUTH_USERNAME &&
    password === process.env.AUTH_PASSWORD
  ) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ success: true, username, wsToken: makeWsToken(req.session.id) });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

// GET /api/verify
router.get('/verify', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({
      authenticated: true,
      username: req.session.username,
      wsToken: makeWsToken(req.session.id),
    });
  }
  return res.json({ authenticated: false });
});

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

module.exports = router;
