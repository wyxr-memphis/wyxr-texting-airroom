import React from 'react';
import { Eye, MessageSquare } from 'lucide-react';
import { formatPhoneNumber, formatTime } from '../utils/formatters';
import './ConversationThread.css';

const ConversationThread = ({ conversation, onMarkRead, onReply }) => {
  const { phone, messages, hasUnread, opted_in, unreadCount, first_name } = conversation;
  const latestMessage = messages[messages.length - 1];

  const handleMarkAllRead = () => {
    messages.filter(m => !m.read).forEach(m => onMarkRead(m.id, true));
  };

  const handleReply = (e) => {
    e.stopPropagation();
    onReply(latestMessage);
  };

  return (
    <div className={`conversation-thread ${hasUnread ? 'has-unread' : 'all-read'}`}>
      <div className="thread-header">
        {first_name && <span className="thread-name">{first_name}</span>}
        <span className="thread-phone">{formatPhoneNumber(phone)}</span>
        <div className="thread-header-right">
          {hasUnread && (
            <span className="thread-unread-badge">{unreadCount} unread</span>
          )}
          <span className="thread-latest-time">{formatTime(latestMessage.timestamp)}</span>
        </div>
      </div>

      <div className="thread-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`thread-message ${msg.read ? 'read' : 'unread'}`}>
            <div className="thread-message-meta">
              {!msg.read && <div className="thread-unread-dot" />}
              <span className="thread-message-time">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="thread-message-text">{msg.text}</div>
            {msg.replied && msg.reply_text && (
              <div className="thread-reply">
                <div className="thread-reply-label">Your reply:</div>
                <div className="thread-reply-text">{msg.reply_text}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="thread-actions">
        {hasUnread && (
          <button className="action-btn mark-read" onClick={handleMarkAllRead}>
            <Eye size={16} />
            <span>Mark All Read</span>
          </button>
        )}
        {opted_in && (
          <button className="action-btn reply-btn" onClick={handleReply}>
            <MessageSquare size={16} />
            <span>Reply</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ConversationThread;
