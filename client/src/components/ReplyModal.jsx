import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { formatPhoneNumber } from '../utils/formatters';
import './ReplyModal.css';

const QUICK_REPLIES = [
  "Thanks for listening to WYXR 91.7!",
  "We'll play your request soon!",
  "Thanks for your feedback!",
  "Stay tuned to WYXR 91.7!"
];

const ReplyModal = ({ message, onClose, onSend }) => {
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleQuickReply = (text) => {
    setReplyText(text);
  };

  const handleSend = async () => {
    if (!replyText.trim()) {
      setError('Please enter a reply message');
      return;
    }

    setSending(true);
    setError('');

    try {
      await onSend(message.id, replyText);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Reply to {formatPhoneNumber(message.phone)}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="modal-body">
          <div className="original-message">
            <div className="original-label">Original message:</div>
            <div className="original-text">{message.text}</div>
          </div>

          <div className="quick-replies">
            <div className="quick-replies-label">Quick replies:</div>
            <div className="quick-replies-buttons">
              {QUICK_REPLIES.map((text, index) => (
                <button
                  key={index}
                  className="quick-reply-button"
                  onClick={() => handleQuickReply(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div className="custom-reply">
            <label htmlFor="reply-text">Your reply:</label>
            <textarea
              id="reply-text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your reply..."
              rows={4}
              autoFocus
            />
          </div>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="modal-button cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="modal-button send"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? 'Sending...' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReplyModal;
