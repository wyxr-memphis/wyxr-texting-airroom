import React from 'react';
import { Power } from 'lucide-react';
import GettingStarted from './GettingStarted';
import './Header.css';

const Header = ({ unreadCount, messagingEnabled, onToggleMessaging, onLogout, pledgeDriveMode, onTogglePledgeDrive }) => {
  const listenerPhone = process.env.REACT_APP_LISTENER_PHONE || '901-555-WYXR';

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left-section">
          <h3 className="header-logo">
            {pledgeDriveMode ? 'WYXR DJ and Staff Communicator' : '📻 WYXR Listener Messages'}
          </h3>
          {pledgeDriveMode ? (
            <div className="on-air-box pledge-drive-box">
              <strong>PLEDGE DRIVE MODE</strong>
              <p>
                Keep an eye here for messages from staff about the pledge drive.
                <strong> Remind listeners to donate — not to send texts!</strong>
              </p>
            </div>
          ) : (
            <div className="on-air-box">
              <strong>📢 READ ON-AIR:</strong>
              <p>
                "Want to reach me while I'm on air? Text <strong>{listenerPhone}</strong> and I'll see your message in real-time.
                Send shout-outs or just say hey!"
              </p>
            </div>
          )}
        </div>

        <div className="header-right">
          <div className="header-buttons">
            {!pledgeDriveMode && <GettingStarted />}

            {!pledgeDriveMode && (
              <button
                onClick={onToggleMessaging}
                className={`power-toggle ${messagingEnabled ? 'enabled' : 'disabled'}`}
                title={messagingEnabled ? 'Messaging ON - Click to disable' : 'Messaging OFF - Click to enable'}
              >
                <Power size={24} />
                <span>{messagingEnabled ? 'ON' : 'OFF'}</span>
              </button>
            )}

            <button
              onClick={onTogglePledgeDrive}
              className={`pledge-toggle ${pledgeDriveMode ? 'active' : ''}`}
              title={pledgeDriveMode ? 'Pledge Drive Mode ON' : 'Pledge Drive Mode OFF'}
            >
              <span>Pledge Drive {pledgeDriveMode ? 'ON' : 'OFF'}</span>
            </button>

            <button onClick={onLogout} className="logout-button">
              Logout
            </button>
          </div>

          <div className="header-right-info">
            <div className="message-info">
              📅 Messages shown for last 2 hours • All messages stored permanently
            </div>
            {unreadCount > 0 && (
              <div className="unread-badge">
                {unreadCount} unread message{unreadCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
