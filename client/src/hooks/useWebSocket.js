import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const useWebSocket = (authenticated, wsToken, onMessageNew, onMessageUpdated, onSettingsUpdated, onReconnect, onContactUpdated) => {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!authenticated || !wsToken) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Connect directly to Render in production (bypasses Vercel, which can't
    // reliably proxy WebSocket auth with a cookie on the Vercel domain).
    // In dev, use REACT_APP_API_URL (defaults to localhost:3001).
    const WS_URL = process.env.NODE_ENV === 'production'
      ? 'https://wyxr-texting-airroom.onrender.com'
      : (process.env.REACT_APP_API_URL || 'http://localhost:3001');

    const socket = io(WS_URL, {
      auth: { token: wsToken },
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    let hasConnectedBefore = false;

    socket.on('connect', () => {
      console.log('WebSocket connected');
      if (hasConnectedBefore && onReconnect) {
        console.log('WebSocket reconnected, refetching messages...');
        onReconnect();
      }
      hasConnectedBefore = true;
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    socket.on('message:new', (message) => {
      console.log('New message received:', message);
      if (onMessageNew) onMessageNew(message);
    });

    socket.on('message:updated', (message) => {
      console.log('Message updated:', message);
      if (onMessageUpdated) onMessageUpdated(message);
    });

    socket.on('settings:updated', (settings) => {
      console.log('Settings updated:', settings);
      if (onSettingsUpdated) onSettingsUpdated(settings);
    });

    socket.on('contact:updated', (contact) => {
      console.log('Contact updated:', contact);
      if (onContactUpdated) onContactUpdated(contact);
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    return () => {
      socket.disconnect();
    };
  }, [authenticated, wsToken, onMessageNew, onMessageUpdated, onSettingsUpdated, onReconnect, onContactUpdated]);

  return socketRef.current;
};

export default useWebSocket;
