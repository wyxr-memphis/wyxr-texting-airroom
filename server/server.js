require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./config/database');
const sessionConfig = require('./config/session');
const setupWebSocket = require('./websocket/handlers');

const app = express();
const server = http.createServer(app);

// Allowed CORS origins
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://wyxr-texting-airroom.vercel.app',
  'https://wyxr-texting-airroom.onrender.com',
  'https://wyxr.org',
  'https://www.wyxr.org'
];

// Socket.io setup with session sharing
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

// Trust proxy (Render/Cloudflare)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers (X-Frame-Options, nosniff, etc.). CSP is disabled for
// now: the server-rendered admin pages rely on inline <script>/<style>, so a
// strict CSP would break them. Referrer-Policy must NOT be helmet's default
// 'no-referrer': pages served under that policy make Chrome send
// "Origin: null" even on same-origin form/fetch POSTs, which broke admin
// login. The browser-default policy keeps Origin intact while still
// trimming the referrer path on cross-origin requests.
app.use(helmet({
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Twilio webhook — mounted BEFORE the global body parsers so the route's own
// urlencoded parser (extended: false) parses the body. Signature validation
// requires the flat key/value params Twilio signed; the global qs parser
// (extended: true) would decode bracket-syntax keys into nested objects and
// break verification. Also mounted before the CSRF origin check, which would
// otherwise reject Twilio's origin-less POSTs.
const webhookRoutes = require('./routes/webhook');
app.use('/webhook', webhookRoutes);

// CSRF protection: production session cookies use sameSite 'none', so the
// browser attaches them to cross-site requests — a malicious page could
// submit a plain HTML form to authenticated endpoints with a logged-in DJ's
// cookie. Reject state-changing requests unless the Origin header is present
// and one of ours. Same-origin form/fetch POSTs send an Origin header in all
// modern browsers, so the admin HTML pages keep working. /webhook is mounted
// above this middleware (Twilio signs its requests instead), and the login
// routes are exempt (they're what creates the session in the first place).
// Runs before the CORS middleware so blocked requests get a clean 403 rather
// than CORS's 500 error path.
const csrfExemptPaths = new Set(['/api/login', '/admin/login']);
const csrfAllowedOrigins = [
  ...allowedOrigins,
  // Admin pages are served by this server itself on localhost in dev
  `http://localhost:${process.env.PORT || 3001}`
];
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (csrfExemptPaths.has(req.path)) return next();
  const origin = req.headers.origin;
  if (origin && csrfAllowedOrigins.includes(origin)) return next();
  console.warn(`Blocked cross-site ${req.method} ${req.path} (Origin: ${origin || 'missing'}, IP: ${req.ip})`);
  return res.status(403).json({ error: 'Cross-site request blocked' });
});

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Twilio webhooks, server-to-server, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Disallowed origin: respond without CORS headers (the browser blocks
    // cross-origin reads) instead of erroring — an Error here became a 500
    // for ordinary page requests that happened to carry an Origin header.
    return callback(null, false);
  },
  credentials: true,
  exposedHeaders: ['set-cookie']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);

// Share session with Socket.io
io.engine.use(sessionMiddleware);

// Make io available to routes
app.set('io', io);

// Setup WebSocket handlers
setupWebSocket(io);

// Routes
const authRoutes = require('./routes/auth');
const messagesRoutes = require('./routes/messages');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');
const broadcastRoutes = require('./routes/broadcasts');
const webOptInRoutes = require('./routes/web-opt-in');
const broadcastWorker = require('./services/broadcastWorker');

app.use('/api', authRoutes);
app.use('/api', messagesRoutes);
app.use('/api', settingsRoutes);
app.use('/admin', broadcastRoutes);
app.use('/admin', adminRoutes);
app.use('/api/sms', webOptInRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'error' });
  }
});

// After an uncaught exception the process may be in a corrupt state — log
// and exit so Render restarts the service cleanly.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, exiting:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown (Render sends SIGTERM before killing)
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  broadcastWorker.stop();
  server.close(() => {
    pool.end(() => {
      console.log('Server and database pool closed');
      process.exit(0);
    });
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Broadcast send worker. Polls for a broadcast with status='sending' and
  // sends one recipient per tick, so a bulk send survives restarts and
  // free-tier spin-down. Reconciles interrupted sends against Twilio on boot.
  broadcastWorker.start();

  // Keep-alive: ping own public URL to prevent Render free-tier spin-down
  if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
    const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const healthUrl = `${process.env.RENDER_EXTERNAL_URL}/health`;

    setInterval(async () => {
      try {
        const res = await fetch(healthUrl);
        console.log(`[keep-alive] Pinged ${healthUrl} — status ${res.status}`);
      } catch (err) {
        console.error(`[keep-alive] Ping failed:`, err.message);
      }
    }, PING_INTERVAL);

    console.log(`[keep-alive] Will ping ${healthUrl} every ${PING_INTERVAL / 60000} min`);
  }
});
