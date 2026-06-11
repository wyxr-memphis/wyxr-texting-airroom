const rateLimit = require('express-rate-limit');

// Per-IP limit: 10 login attempts per 15 minutes.
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

// Global cap across all IPs: blunts distributed brute-force attempts.
const loginGlobalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  keyGenerator: () => 'global',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

// Apply in this order so the per-IP limit is what most clients hit first.
const loginLimiters = [loginGlobalLimiter, loginIpLimiter];

module.exports = { loginLimiters };
