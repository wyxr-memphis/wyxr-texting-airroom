require('dotenv').config();
const pool = require('./config/database');
const { server } = require('./app');
const broadcastWorker = require('./services/broadcastWorker');

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
