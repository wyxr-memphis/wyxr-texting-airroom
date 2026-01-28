import React from 'react';
import { Power } from 'lucide-react';
import './Header.css';

const Header = ({ unreadCount, messagingEnabled, onToggleMessaging, onLogout }) => {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <h1 className="header-title">WYXR 91.7 FM</h1>
          <p className="header-subtitle">Text Messages</p>
        </div>

        <div className="header-center">
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
