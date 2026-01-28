const express = require('express');
const router = express.Router();

// POST /api/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.AUTH_USERNAME &&
    password === process.env.AUTH_PASSWORD
  ) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ success: true, username });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

// GET /api/verify
router.get('/verify', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true, username: req.session.username });
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
