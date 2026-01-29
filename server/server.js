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

// Socket.io setup with session sharing
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

// Trust proxy (Render/Cloudflare)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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

app.use('/api', authRoutes);
app.use('/api', messagesRoutes);
app.use('/api', settingsRoutes);
app.use('/webhook', webhookRoutes);
app.use('/admin', adminRoutes);

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
