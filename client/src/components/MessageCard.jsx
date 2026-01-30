import React from 'react';
import { formatPhoneNumber, formatTime } from '../utils/formatters';
import { MessageSquare, CheckCheck, Eye, EyeOff } from 'lucide-react';
import './MessageCard.css';

const MessageCard = ({ message, onMarkRead, onReply }) => {
  const handleMarkRead = (e) => {
    e.stopPropagation();
    onMarkRead(message.id, !message.read);
  };

  const handleReply = (e) => {
    e.stopPropagation();
    onReply(message);
  };

  return (
    <div className={`message-card ${message.read ? 'read' : 'unread'}`}>
      {!message.read && <div className="unread-indicator" />}

      <div className="message-header">
        <span className="message-phone">{formatPhoneNumber(message.phone)}</span>
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

      <div className="message-actions">
        <button
          className={`action-btn ${message.read ? 'mark-unread' : 'mark-read'}`}
          onClick={handleMarkRead}
          title={message.read ? 'Mark as unread' : 'Mark as read'}
        >
          {message.read ? <EyeOff size={16} /> : <Eye size={16} />}
          <span>{message.read ? 'Mark Unread' : 'Mark Read'}</span>
        </button>

        <button
          className="action-btn reply-btn"
          onClick={handleReply}
          title="Reply to this message"
        >
          <MessageSquare size={16} />
          <span>Reply</span>
        </button>
      </div>
    </div>
  );
};

export default MessageCard;
