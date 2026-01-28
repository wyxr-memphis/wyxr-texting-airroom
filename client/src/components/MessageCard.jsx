import React from 'react';
import { formatPhoneNumber, formatTime } from '../utils/formatters';
import './MessageCard.css';

const MessageCard = ({ message, onMarkRead, onReply }) => {
  const handleCardClick = () => {
    onMarkRead(message.id, !message.read);
  };

  const handlePhoneClick = (e) => {
    e.stopPropagation();
    onReply(message);
  };

  return (
    <div
      className={`message-card ${message.read ? 'read' : 'unread'}`}
      onClick={handleCardClick}
    >
      {!message.read && <div className="unread-indicator" />}

      <div className="message-header">
        <button
          className="message-phone"
          onClick={handlePhoneClick}
          title="Click to reply"
        >
          {formatPhoneNumber(message.phone)}
        </button>
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>

      <div className="message-text">{message.text}</div>

      {message.replied && message.reply_text && (
        <div className="message-reply">
          <div className="reply-label">Your reply:</div>
          <div className="reply-text">{message.reply_text}</div>
          <div className="reply-time">{formatTime(message.replied_at)}</div>
        </div>
      )}
    </div>
  );
};

export default MessageCard;
