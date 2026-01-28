const setupWebSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Verify session authentication
    const session = socket.request.session;
    if (!session || !session.authenticated) {
      console.log('Unauthenticated socket connection, disconnecting');
      socket.disconnect(true);
      return;
    }

    console.log('Authenticated user connected:', session.username);

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });

    // Additional handlers can be added here if needed
  });
};

module.exports = setupWebSocket;
