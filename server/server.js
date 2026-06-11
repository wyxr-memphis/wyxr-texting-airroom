require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
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

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Twilio webhooks, server-to-server, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  exposedHeaders: ['set-cookie']
}));
// Twilio webhook — mounted BEFORE the global body parsers so the route's own
// urlencoded parser (extended: false) parses the body. Signature validation
// requires the flat key/value params Twilio signed; the global qs parser
// (extended: true) would decode bracket-syntax keys into nested objects and
// break verification.
const webhookRoutes = require('./routes/webhook');
app.use('/webhook', webhookRoutes);

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
const webOptInRoutes = require('./routes/web-opt-in');

app.use('/api', authRoutes);
app.use('/api', messagesRoutes);
app.use('/api', settingsRoutes);
app.use('/admin', adminRoutes);
app.use('/api/sms', webOptInRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown (Render sends SIGTERM before killing)
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
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
