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

module.exports = { requireAuth, requireAuthAdmin };
