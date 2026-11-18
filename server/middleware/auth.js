// A session with no role (including every session created before staff
// logins existed) counts as the shared DJ login.
const sessionRole = (req) =>
  req.session && req.session.authenticated && req.session.role === 'staff' ? 'staff' : 'dj';

const isStaff = (req) => Boolean(req.session && req.session.authenticated && req.session.role === 'staff');

const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
};

// For admin HTML pages — redirects to login form instead of returning JSON
const requireAuthAdmin = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/admin/login');
};

// Staff-only JSON endpoints
const requireStaff = (req, res, next) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!isStaff(req)) {
    return res.status(403).json({ error: 'Staff login required' });
  }
  return next();
};

// Staff-only HTML pages. A signed-in DJ session is sent to the login form
// with a note asking for the staff login.
const requireStaffAdmin = (req, res, next) => {
  if (isStaff(req)) return next();
  return res.redirect('/admin/login?staff=1');
};

module.exports = {
  requireAuth,
  requireAuthAdmin,
  requireStaff,
  requireStaffAdmin,
  sessionRole,
  isStaff
};
