import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const useWebSocket = (authenticated, onMessageNew, onMessageUpdated, onSettingsUpdated) => {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!authenticated) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

    const socket = io(API_URL, {
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('WebSocket connected');
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

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    return () => {
      socket.disconnect();
    };
  }, [authenticated, onMessageNew, onMessageUpdated, onSettingsUpdated]);

  return socketRef.current;
};

export default useWebSocket;
