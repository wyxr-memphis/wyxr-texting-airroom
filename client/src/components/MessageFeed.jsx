import React from 'react';
import MessageCard from './MessageCard';
import './MessageFeed.css';

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
          <p>Messages from the last 12 hours will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-feed">
      <div className="message-grid">
        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            onMarkRead={onMarkRead}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
};

export default MessageFeed;
