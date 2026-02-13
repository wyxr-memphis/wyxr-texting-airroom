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
const webhookRoutes = require('./routes/webhook');
const adminRoutes = require('./routes/admin');
const webOptInRoutes = require('./routes/web-opt-in');

app.use('/api', authRoutes);
app.use('/api', messagesRoutes);
app.use('/api', settingsRoutes);
app.use('/webhook', webhookRoutes);
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

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
