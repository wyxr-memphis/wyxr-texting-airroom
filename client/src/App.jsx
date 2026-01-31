import React, { useState, useEffect, useCallback } from 'react';
import Login from './components/Login';
import Header from './components/Header';
import MessageFeed from './components/MessageFeed';
import ReplyModal from './components/ReplyModal';
import useWebSocket from './hooks/useWebSocket';
import * as api from './services/api';
import './App.css';

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [messagingEnabled, setMessagingEnabled] = useState(true);
  const [replyModalMessage, setReplyModalMessage] = useState(null);

  // WebSocket handlers
  const handleMessageNew = useCallback((message) => {
    setMessages((prev) => [message, ...prev]);
  }, []);

  const handleMessageUpdated = useCallback((updatedMessage) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === updatedMessage.id ? updatedMessage : msg))
    );
  }, []);

  const handleSettingsUpdated = useCallback((settings) => {
    setMessagingEnabled(settings.messagingEnabled);
  }, []);

  // Initialize WebSocket
  useWebSocket(authenticated, handleMessageNew, handleMessageUpdated, handleSettingsUpdated);

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await api.verify();
        setAuthenticated(result.authenticated);
      } catch (error) {
        console.error('Auth check failed:', error);
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Load initial data when authenticated
  useEffect(() => {
    if (!authenticated) return;

    const loadData = async () => {
      try {
        const [messagesData, settingsData] = await Promise.all([
          api.getMessages(),
          api.getMessagingEnabled()
        ]);

        setMessages(messagesData);
        setMessagingEnabled(settingsData.enabled);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    };

    loadData();
  }, [authenticated]);

  const handleLogin = async (username, password) => {
    await api.login(username, password);
    setAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setAuthenticated(false);
      setMessages([]);
    }
  };

  const handleMarkRead = async (id, read) => {
    try {
      await api.updateMessageReadStatus(id, read);
      // Update will come through WebSocket
    } catch (error) {
      console.error('Failed to update message:', error);
    }
  };

  const handleReply = (message) => {
    setReplyModalMessage(message);
  };

  const handleSendReply = async (id, replyText) => {
    await api.replyToMessage(id, replyText);
    // Update will come through WebSocket
  };

  const handleToggleMessaging = async () => {
    try {
      await api.setMessagingEnabled(!messagingEnabled);
      // Update will come through WebSocket
    } catch (error) {
      console.error('Failed to toggle messaging:', error);
    }
  };

  const unreadCount = messages.filter((msg) => !msg.read).length;

  // Update document title with unread count
  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) WYXR Text App`;
    } else {
      document.title = 'WYXR Text App';
    }
  }, [unreadCount]);

  if (loading) {
    return (
      <div className="app-loading">
        <div>Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <Header
        unreadCount={unreadCount}
        messagingEnabled={messagingEnabled}
        onToggleMessaging={handleToggleMessaging}
        onLogout={handleLogout}
      />

      <MessageFeed
        messages={messages}
        messagingEnabled={messagingEnabled}
        onMarkRead={handleMarkRead}
        onReply={handleReply}
      />

      {replyModalMessage && (
        <ReplyModal
          message={replyModalMessage}
          onClose={() => setReplyModalMessage(null)}
          onSend={handleSendReply}
        />
      )}
    </div>
  );
}

export default App;
