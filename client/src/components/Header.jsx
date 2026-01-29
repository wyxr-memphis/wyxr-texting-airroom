import React from 'react';
import { Power } from 'lucide-react';
import './Header.css';

const Header = ({ unreadCount, messagingEnabled, onToggleMessaging, onLogout }) => {
  const listenerPhone = process.env.REACT_APP_LISTENER_PHONE || '901-555-WYXR';

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-center">
          <div className="listener-info">
            <h3>📻 WYXR Listener Messages</h3>
            <div className="on-air-box">
              <strong>📢 READ ON-AIR:</strong>
              <p>
                "Want to reach me while I'm on air? Text <strong>{listenerPhone}</strong> and I'll see your message in real-time.
                Send requests, shout-outs, or just say hey!"
              </p>
            </div>
            <div className="message-info">
              📅 Messages shown for last 12 hours • All messages stored permanently
            </div>
          </div>

          <div className="instructions">
            <p className="instruction-title">Instructions:</p>
            <p>Click message to mark read/unread • Click phone number to reply</p>
          </div>

          {unreadCount > 0 && (
            <div className="unread-badge">
              {unreadCount} unread message{unreadCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        <div className="header-right">
          <button
            onClick={onToggleMessaging}
            className={`power-toggle ${messagingEnabled ? 'enabled' : 'disabled'}`}
            title={messagingEnabled ? 'Messaging ON - Click to disable' : 'Messaging OFF - Click to enable'}
          >
            <Power size={24} />
            <span>{messagingEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button onClick={onLogout} className="logout-button">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
