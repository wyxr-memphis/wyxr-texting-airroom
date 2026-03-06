import React from 'react';
import ConversationThread from './ConversationThread';
import './MessageFeed.css';

const groupIntoConversations = (messages) => {
  const groups = {};

  messages.forEach((msg) => {
    if (!groups[msg.phone]) {
      groups[msg.phone] = [];
    }
    groups[msg.phone].push(msg);
  });

  return Object.entries(groups).map(([phone, msgs]) => {
    const sorted = [...msgs].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    const unread = sorted.filter(m => !m.read);
    const opted_in = sorted.some(m => m.opted_in === true);
    const latestTimestamp = sorted[sorted.length - 1].timestamp;

    return {
      phone,
      messages: sorted,
      hasUnread: unread.length > 0,
      unreadCount: unread.length,
      opted_in,
      latestTimestamp,
    };
  }).sort(
    (a, b) => new Date(b.latestTimestamp) - new Date(a.latestTimestamp)
  );
};

const MessageFeed = ({ messages, messagingEnabled, onMarkRead, onReply }) => {
  if (!messagingEnabled) {
    return (
      <div className="message-feed-disabled">
        <div className="disabled-message">
          <h2>Messaging is currently OFF</h2>
          <p>Click the power button in the header to enable messaging</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="message-feed-empty">
        <div className="empty-message">
          <h2>No messages yet</h2>
          <p>Messages from the last 2 hours will appear here</p>
        </div>
      </div>
    );
  }

  const conversations = groupIntoConversations(messages);

  return (
    <div className="message-feed">
      <div className="message-grid">
        {conversations.map((conversation) => (
          <ConversationThread
            key={conversation.phone}
            conversation={conversation}
            onMarkRead={onMarkRead}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
};

export default MessageFeed;
