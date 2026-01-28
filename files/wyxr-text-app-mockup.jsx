import React, { useState } from 'react';
import { MessageSquare, Send, Check, X, Power } from 'lucide-react';

export default function WYXRListenerTextApp() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [messages, setMessages] = useState([
    {
      id: 1,
      phone: '901-555-0123',
      text: "Love this song! What's the artist?",
      timestamp: new Date(Date.now() - 120000),
      read: false,
      replied: false
    },
    {
      id: 2,
      phone: '901-555-0156',
      text: 'Listening from Midtown! Y\'all are the best station in Memphis 🎵',
      timestamp: new Date(Date.now() - 300000),
      read: true,
      replied: false
    },
    {
      id: 3,
      phone: '901-555-0189',
      text: 'Can you play some Stax classics?',
      timestamp: new Date(Date.now() - 480000),
      read: true,
      replied: true,
      replyText: 'Thanks for listening! Got some Stax coming up soon 🎶'
    },
    {
      id: 4,
      phone: '901-555-0134',
      text: 'First time listener - how do I support the station?',
      timestamp: new Date(Date.now() - 600000),
      read: true,
      replied: false
    }
  ]);

  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');

  const quickReplies = [
    "Thanks for listening to WYXR!",
    "We appreciate you tuning in!",
    "Great request - I'll see what I can do!",
    "Love hearing from Memphis listeners!"
  ];

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const markAsRead = (id) => {
    setMessages(messages.map(msg => 
      msg.id === id ? { ...msg, read: true } : msg
    ));
  };

  const markAsUnread = (id) => {
    setMessages(messages.map(msg => 
      msg.id === id ? { ...msg, read: false } : msg
    ));
  };

  const handleReply = (msg) => {
    setReplyingTo(msg);
    setReplyText('');
  };

  const sendReply = () => {
    if (!replyText.trim()) return;
    
    setMessages(messages.map(msg => 
      msg.id === replyingTo.id 
        ? { ...msg, read: true, replied: true, replyText } 
        : msg
    ));
    setReplyingTo(null);
    setReplyText('');
  };

  const unreadCount = messages.filter(m => !m.read).length;

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#2B2B2B',
      padding: '20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header Row - Horizontal Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '20px',
        marginBottom: '20px'
      }}>
        {/* Left: Instructions & Info */}
        <div style={{
          background: '#FFC629',
          borderRadius: '12px',
          padding: '20px',
          border: '3px solid #E9407A'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <MessageSquare size={28} color="#2B2B2B" />
            <h1 style={{ 
              margin: 0, 
              fontSize: '24px', 
              color: '#2B2B2B',
              fontWeight: '700'
            }}>
              WYXR Listener Messages
            </h1>
          </div>
          
          <div style={{
            background: 'rgba(0,0,0,0.05)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '12px',
            border: '2px solid #2B2B2B'
          }}>
            <div style={{ 
              fontSize: '13px', 
              fontWeight: '600',
              color: '#2B2B2B',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              📻 Read On-Air:
            </div>
            <div style={{ 
              fontSize: '16px', 
              color: '#2B2B2B',
              fontWeight: '500',
              lineHeight: '1.5'
            }}>
              "Want to reach me while I'm on air? Text <strong style={{ fontSize: '18px' }}>901-555-WYXR</strong> and I'll see your message in real-time. Send requests, shout-outs, or just say hey!"
            </div>
          </div>

          <div style={{
            fontSize: '12px',
            color: '#2B2B2B',
            background: 'rgba(233,64,122,0.1)',
            padding: '8px 12px',
            borderRadius: '6px',
            marginBottom: '12px',
            fontWeight: '500'
          }}>
            💾 Messages shown for last 24 hours • All messages stored permanently
          </div>

          {unreadCount > 0 && (
            <div style={{
              display: 'inline-block',
              background: '#E9407A',
              color: '#FFC629',
              padding: '8px 16px',
              borderRadius: '20px',
              fontSize: '16px',
              fontWeight: '700',
              border: '2px solid #2B2B2B'
            }}>
              {unreadCount} NEW MESSAGE{unreadCount !== 1 ? 'S' : ''}
            </div>
          )}
        </div>

        {/* Right: Toggle */}
        <div style={{
          background: isEnabled ? '#2B9EB3' : '#666',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '180px',
          border: '3px solid ' + (isEnabled ? '#FFC629' : '#444'),
          transition: 'all 0.3s ease'
        }}>
          <Power size={32} color="#FFC629" style={{ marginBottom: '12px' }} />
          <div style={{ 
            fontSize: '14px',
            fontWeight: '600',
            color: '#FFC629',
            marginBottom: '12px',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Messaging
          </div>
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            style={{
              background: isEnabled ? '#E9407A' : '#888',
              border: '2px solid #FFC629',
              color: '#FFC629',
              padding: '10px 20px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '700',
              transition: 'all 0.2s',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            {isEnabled ? 'TURN OFF' : 'TURN ON'}
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      {isEnabled ? (
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))',
          gap: '16px'
        }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                background: msg.read 
                  ? 'rgba(255,255,255,0.05)' 
                  : '#FFC629',
                border: msg.read 
                  ? '2px solid rgba(255,255,255,0.1)' 
                  : '3px solid #E9407A',
                borderRadius: '12px',
                padding: '16px',
                transition: 'all 0.3s ease',
                boxShadow: msg.read 
                  ? 'none' 
                  : '0 4px 20px rgba(233,64,122,0.3)'
              }}
            >
              {/* Message Header */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ 
                    color: msg.read ? '#2B9EB3' : '#E9407A',
                    fontSize: '16px',
                    fontWeight: '700',
                    fontFamily: 'monospace',
                    background: msg.read ? 'rgba(43,158,179,0.1)' : 'rgba(233,64,122,0.15)',
                    padding: '4px 8px',
                    borderRadius: '4px'
                  }}>
                    {msg.phone}
                  </span>
                  <span style={{ 
                    color: msg.read ? 'rgba(255,255,255,0.4)' : '#2B2B2B',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}>
                    {formatTime(msg.timestamp)}
                  </span>
                  {msg.replied && (
                    <span style={{
                      background: '#2B9EB3',
                      color: '#FFC629',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: '2px solid #2B2B2B'
                    }}>
                      REPLIED
                    </span>
                  )}
                </div>
                {!msg.read && (
                  <div style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#E9407A',
                    border: '2px solid #2B2B2B',
                    animation: 'pulse 2s infinite'
                  }} />
                )}
              </div>

              {/* Message Text */}
              <div style={{ 
                color: msg.read ? '#fff' : '#2B2B2B',
                fontSize: '17px',
                lineHeight: '1.5',
                marginBottom: msg.replied ? '10px' : '14px',
                fontWeight: msg.read ? '400' : '600'
              }}>
                {msg.text}
              </div>

              {/* Reply Preview */}
              {msg.replied && (
                <div style={{
                  background: 'rgba(43,158,179,0.15)',
                  border: '2px solid #2B9EB3',
                  borderRadius: '8px',
                  padding: '10px',
                  marginBottom: '14px',
                  fontSize: '14px',
                  color: msg.read ? 'rgba(255,255,255,0.8)' : '#2B2B2B'
                }}>
                  <div style={{ 
                    color: '#2B9EB3',
                    fontSize: '11px', 
                    marginBottom: '6px',
                    fontWeight: '700',
                    textTransform: 'uppercase'
                  }}>
                    Your Reply:
                  </div>
                  {msg.replyText}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                {!msg.read ? (
                  <button
                    onClick={() => markAsRead(msg.id)}
                    style={{
                      background: '#2B2B2B',
                      border: '2px solid #2B9EB3',
                      color: '#FFC629',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                      textTransform: 'uppercase'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = '#2B9EB3';
                      e.currentTarget.style.color = '#2B2B2B';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = '#2B2B2B';
                      e.currentTarget.style.color = '#FFC629';
                    }}
                  >
                    <Check size={16} />
                    Mark Read
                  </button>
                ) : (
                  <button
                    onClick={() => markAsUnread(msg.id)}
                    style={{
                      background: 'rgba(255,198,41,0.1)',
                      border: '2px solid rgba(255,198,41,0.3)',
                      color: '#FFC629',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                      textTransform: 'uppercase'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = 'rgba(255,198,41,0.2)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = 'rgba(255,198,41,0.1)';
                    }}
                  >
                    <X size={16} />
                    Mark Unread
                  </button>
                )}
                {!msg.replied && (
                  <button
                    onClick={() => handleReply(msg)}
                    style={{
                      background: '#E9407A',
                      border: '2px solid #2B2B2B',
                      color: '#FFC629',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                      textTransform: 'uppercase'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <Send size={16} />
                    Reply
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: '60px',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '12px',
          border: '2px dashed rgba(255,255,255,0.2)'
        }}>
          <Power size={48} color="#666" style={{ marginBottom: '16px' }} />
          <div style={{ 
            fontSize: '24px',
            color: '#666',
            fontWeight: '600'
          }}>
            Messaging is currently off
          </div>
          <div style={{ 
            fontSize: '16px',
            color: '#888',
            marginTop: '8px'
          }}>
            Turn it on in the top right to receive listener texts
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {replyingTo && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          zIndex: 1000
        }}>
          <div style={{
            background: '#2B2B2B',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '700px',
            width: '100%',
            border: '4px solid #FFC629'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h2 style={{ 
                margin: 0, 
                color: '#FFC629',
                fontSize: '24px',
                fontWeight: '700'
              }}>
                Reply to {replyingTo.phone}
              </h2>
              <button
                onClick={() => setReplyingTo(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  padding: '8px'
                }}
              >
                <X size={24} />
              </button>
            </div>

            <div style={{
              background: 'rgba(43,158,179,0.15)',
              border: '2px solid #2B9EB3',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px',
              color: '#fff',
              fontSize: '16px'
            }}>
              {replyingTo.text}
            </div>

            {/* Quick Reply Templates */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '13px',
                color: '#FFC629',
                fontWeight: '700',
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Quick Replies:
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {quickReplies.map((template, idx) => (
                  <button
                    key={idx}
                    onClick={() => setReplyText(template)}
                    style={{
                      background: replyText === template ? '#E9407A' : 'rgba(255,198,41,0.1)',
                      border: '2px solid ' + (replyText === template ? '#FFC629' : 'rgba(255,198,41,0.3)'),
                      color: '#FFC629',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '600',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => {
                      if (replyText !== template) {
                        e.currentTarget.style.background = 'rgba(255,198,41,0.2)';
                      }
                    }}
                    onMouseOut={(e) => {
                      if (replyText !== template) {
                        e.currentTarget.style.background = 'rgba(255,198,41,0.1)';
                      }
                    }}
                  >
                    {template}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your reply or choose a quick reply above..."
              style={{
                width: '100%',
                minHeight: '120px',
                background: 'rgba(255,255,255,0.05)',
                border: '2px solid rgba(255,198,41,0.3)',
                borderRadius: '8px',
                padding: '16px',
                color: '#fff',
                fontSize: '16px',
                fontFamily: 'inherit',
                resize: 'vertical',
                marginBottom: '20px'
              }}
              autoFocus
            />

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setReplyingTo(null)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '2px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  padding: '12px 24px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: '700',
                  textTransform: 'uppercase'
                }}
              >
                Cancel
              </button>
              <button
                onClick={sendReply}
                disabled={!replyText.trim()}
                style={{
                  background: replyText.trim() ? '#E9407A' : '#666',
                  border: '2px solid ' + (replyText.trim() ? '#FFC629' : '#444'),
                  color: '#FFC629',
                  padding: '12px 24px',
                  borderRadius: '8px',
                  cursor: replyText.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '16px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textTransform: 'uppercase',
                  opacity: replyText.trim() ? 1 : 0.5
                }}
              >
                <Send size={18} />
                Send Reply
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}