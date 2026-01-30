import React, { useState } from 'react';
import { X, HelpCircle } from 'lucide-react';
import './GettingStarted.css';

const GettingStarted = () => {
  const [isOpen, setIsOpen] = useState(false);
  const listenerPhone = process.env.REACT_APP_LISTENER_PHONE || '901-460-3031';

  return (
    <>
      <button
        className="getting-started-btn"
        onClick={() => setIsOpen(true)}
        title="Getting Started Guide"
      >
        <HelpCircle size={20} />
        <span>Getting Started</span>
      </button>

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setIsOpen(false)}>
              <X size={24} />
            </button>

            <div className="modal-body">
              <h1>WYXR Listener Text App</h1>
              <h2>Getting Started for DJs</h2>

              <section>
                <h3>👋 Welcome!</h3>
                <p>
                  This app lets listeners text you during your show. Think of it as a low-key way for the
                  community to reach out with shout-outs or just to say hey.
                </p>
              </section>

              <section className="important">
                <h3>⭐ The Most Important Thing First</h3>
                <p>
                  <strong>Creating a great radio show is your #1 priority.</strong> This text app is a tool,
                  not a requirement. Use it if it enhances your show, ignore it if it doesn't. You're here to
                  make great radio, not to be a text message operator.
                </p>
              </section>

              <section>
                <h3>📱 How It Works</h3>
                <div className="two-column">
                  <div>
                    <h4>For Listeners:</h4>
                    <ul>
                      <li>They text <strong>{listenerPhone}</strong> from their phone</li>
                      <li>Their message shows up here instantly</li>
                    </ul>
                  </div>
                  <div>
                    <h4>For You:</h4>
                    <ul>
                      <li>Messages appear as cards on this screen</li>
                      <li>Yellow cards = unread, gray cards = read</li>
                      <li>Click "Mark Read" when you've seen a message</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section>
                <h3>📊 Setting Expectations</h3>
                <p><strong>Here's the reality: You probably won't get many texts.</strong></p>
                <p>Why?</p>
                <ol>
                  <li><strong>Radio is passive</strong> - Most people just listen. Unlike social media, radio audiences don't constantly interact.</li>
                  <li><strong>They don't know it exists</strong> - Listeners won't text if they don't know the number.</li>
                </ol>
                <p>
                  <strong>This is totally normal and okay!</strong> Zero messages during your show doesn't mean
                  you're doing anything wrong. It just means people are listening.
                </p>
              </section>

              <section>
                <h3>🎙️ If You Want to Use This</h3>
                <p><strong>You have to tell listeners about it on-air. Multiple times.</strong></p>

                <div className="sample-read">
                  <p><strong>Here's a sample read you can use:</strong></p>
                  <blockquote>
                    "Want to reach me while I'm on air? Text <strong>{listenerPhone}</strong> and I'll see your
                    message in real-time. Send shout-outs or just say hey!"
                  </blockquote>
                </div>

                <p><strong>How often to mention it:</strong></p>
                <ul>
                  <li>Once at the beginning of your show</li>
                  <li>Once in the middle</li>
                  <li>Once near the end</li>
                </ul>

                <p>
                  <strong>But remember:</strong> Don't make your show about the text line. Mention it briefly,
                  then get back to the music and your show.
                </p>
              </section>

              <section>
                <h3>⚖️ Finding the Balance</h3>
                <div className="two-column">
                  <div className="good">
                    <h4>✅ Good:</h4>
                    <ul>
                      <li>"Text me at {listenerPhone}!"</li>
                      <li>Mentioning it 2-3 times during your show</li>
                      <li>Reading interesting messages on-air when you get them</li>
                      <li>Ignoring the app entirely if you prefer</li>
                    </ul>
                  </div>
                  <div className="not-good">
                    <h4>❌ Not So Good:</h4>
                    <ul>
                      <li>Constantly checking the app</li>
                      <li>Begging for messages</li>
                      <li>Making your show about texting</li>
                      <li>Getting distracted from your show</li>
                      <li>Feeling bad if you don't get messages</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section>
                <h3>💡 Practical Tips</h3>

                <h4>During Your Show:</h4>
                <ul>
                  <li>Glance at the app occasionally, not constantly</li>
                  <li>You don't need to respond to every message</li>
                  <li>Feel free to read fun messages on-air</li>
                  <li>It's okay to ignore spam or inappropriate messages</li>
                </ul>

                <h4>Message Management:</h4>
                <ul>
                  <li>Click "Mark Read" to keep track of what you've seen</li>
                  <li>The app shows messages from the last 12 hours</li>
                  <li>All messages are saved permanently for staff review</li>
                </ul>

                <h4>Technical Stuff:</h4>
                <ul>
                  <li>Works best on desktop/laptop (not mobile)</li>
                  <li>Login: Username <code>wyxr</code>, Password [ask station management]</li>
                  <li>The "ON" button toggles messaging on/off</li>
                </ul>
              </section>

              <section className="faq">
                <h3>❓ Common Questions</h3>

                <div className="qa">
                  <p><strong>Q: Do I have to use this?</strong></p>
                  <p><strong>A:</strong> Nope! It's 100% optional.</p>
                </div>

                <div className="qa">
                  <p><strong>Q: What if I get no messages?</strong></p>
                  <p><strong>A:</strong> Totally normal! Most shows won't get many messages. Don't worry about it.</p>
                </div>

                <div className="qa">
                  <p><strong>Q: Should I promote it every show?</strong></p>
                  <p><strong>A:</strong> Only if you want to use it. If you don't care about texts, don't promote it.</p>
                </div>

                <div className="qa">
                  <p><strong>Q: What if I get inappropriate messages?</strong></p>
                  <p><strong>A:</strong> Just ignore them. Mark them as read and move on. Staff can delete them from the admin panel.</p>
                </div>

                <div className="qa">
                  <p><strong>Q: Can I reply yet?</strong></p>
                  <p><strong>A:</strong> Not yet! SMS replies are coming soon (waiting on carrier approval). For now, just read and enjoy.</p>
                </div>

                <div className="qa">
                  <p><strong>Q: What if someone sends their phone number or personal info?</strong></p>
                  <p><strong>A:</strong> Don't read it on-air. Mark it as read and move on.</p>
                </div>
              </section>

              <section className="bottom-line">
                <h3>🎯 The Bottom Line</h3>
                <p>
                  This app exists to give listeners an easy way to reach out. Use it if it fits your style.
                  Ignore it if it doesn't.
                </p>
                <p>
                  <strong>Your job is to make great radio.</strong> This is just a tool. Like any tool, use it
                  when it helps, set it aside when it doesn't.
                </p>
                <p>Have fun, and thanks for being part of WYXR! 📻</p>
              </section>

              <section className="footer">
                <p><strong>Questions?</strong> Ask station management.</p>
                <p><strong>Problems?</strong> Contact station management.</p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GettingStarted;
