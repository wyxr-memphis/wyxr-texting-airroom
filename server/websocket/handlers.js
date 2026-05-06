const crypto = require('crypto');
const pool = require('../config/database');

// Verify the signed wsToken that clients send in socket.handshake.auth.
// Returns the session row if valid, null otherwise.
async function verifyWsToken(token) {
  if (!token || !token.includes('.')) return null;

  const dotIndex = token.indexOf('.');
  const sessionId = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sessionId)
    .digest('hex');

  if (sig !== expected) return null;

  // Confirm the session is still live and authenticated in the DB
  const result = await pool.query(
    "SELECT sess FROM session WHERE sid = $1 AND expire > NOW()",
    [sessionId]
  );
  if (result.rows.length === 0) return null;

  const sess = result.rows[0].sess;
  return sess.authenticated ? sess : null;
}

const setupWebSocket = (io) => {
  io.on('connection', async (socket) => {
    console.log('Socket connection attempt:', socket.id);

    const token = socket.handshake.auth && socket.handshake.auth.token;
    const sess = await verifyWsToken(token);

    if (!sess) {
      console.log('WebSocket auth failed - disconnecting:', socket.id);
      socket.disconnect(true);
      return;
    }

    console.log('Authenticated socket connected:', sess.username, socket.id);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

module.exports = setupWebSocket;
