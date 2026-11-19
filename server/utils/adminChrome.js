// Shared header and navigation for every server-rendered admin page.
//
// The admin covers two separate phone lines, and staff kept losing track of
// which one they were looking at. Every page now opens with the same header:
//
//   - a line badge: blue "Listener line" or pink "DJ line", with the number
//   - the same two-group nav everywhere: listener pages in blue, DJ pages in
//     pink (the DJ group only renders for staff sessions)
//   - who is signed in, and a Log out button
//
// Colors follow the WYXR brand: blue #2B9EB3 = listener line, pink #E9407A =
// DJ line, yellow #FFC629 = the page you're on.
const { escapeHtml } = require('./html');

const NAV = {
  listener: [
    { key: 'messages', href: '/admin/messages', label: 'Messages' },
    { key: 'contacts', href: '/admin/contacts', label: 'Contacts' },
    { key: 'broadcasts', href: '/admin/broadcasts', label: 'Broadcasts' }
  ],
  dj: [
    { key: 'djs', href: '/admin/djs', label: 'Roster & replies' },
    { key: 'dj-message', href: '/admin/djs/message', label: 'Text all DJs' },
    { key: 'dj-broadcasts', href: '/admin/broadcasts?audience=djs', label: 'Sent to DJs' }
  ]
};

const lineForPage = (active) => (NAV.dj.some((l) => l.key === active) ? 'dj' : 'listener');

const formatPhone = (e164) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 || '');
};

const CHROME_STYLES = `
    .ac-header {
      background: linear-gradient(135deg, #2B2B2B 0%, #1a1a1a 100%);
      padding: 22px 26px; border-radius: 8px; margin-bottom: 28px;
      border: 2px solid var(--ac-line); border-top-width: 8px;
    }
    .ac-line-listener { --ac-line: #2B9EB3; }
    .ac-line-dj { --ac-line: #E9407A; }
    .ac-topbar {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .ac-line-badge {
      background: var(--ac-line); color: #fff; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase; font-size: 0.8rem; padding: 6px 12px; border-radius: 999px;
    }
    .ac-who { color: #aaa; font-size: 0.85rem; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ac-who form { display: inline; margin: 0; }
    .ac-logout {
      width: auto; margin: 0; background: transparent; border: 1px solid #555; color: #ddd;
      border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 0.85rem; font-weight: 500;
    }
    .ac-logout:hover { border-color: #aaa; color: #fff; }
    .ac-header h1 { color: #FFC629; font-size: 2.2rem; margin: 0 0 6px; }
    .ac-header .ac-sub { color: #ccc; font-size: 1.05rem; margin: 0 0 18px; }
    .ac-nav { display: flex; gap: 12px; flex-wrap: wrap; }
    .ac-group {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 8px 10px; border-radius: 8px; border: 1px solid #3a3a3a; background: #202020;
    }
    .ac-group.ac-current { border-color: var(--ac-line); }
    .ac-group-label {
      font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 0 4px;
    }
    .ac-group-listener .ac-group-label { color: #2B9EB3; }
    .ac-group-dj .ac-group-label { color: #E9407A; }
    .ac-group a {
      padding: 8px 14px; border-radius: 6px; color: #fff; text-decoration: none;
      font-weight: 600; font-size: 0.95rem;
    }
    .ac-group-listener a { background: #2B9EB3; }
    .ac-group-dj a { background: #E9407A; }
    .ac-group a:hover { filter: brightness(0.9); }
    .ac-group a.ac-active { background: #FFC629; color: #2B2B2B; }
    @media (max-width: 600px) {
      .ac-header { padding: 18px 16px; }
      .ac-header h1 { font-size: 1.7rem; }
    }
`;

/**
 * Header for an admin page. `active` is a NAV key; it decides which line the
 * page belongs to (and so its color). `role` is 'staff' or 'dj'.
 */
const adminHeader = ({ active, role = 'dj', heading, subtitle }) => {
  const line = lineForPage(active);
  const staff = role === 'staff';

  const badge = line === 'dj'
    ? `DJ line · staff only${process.env.DJ_TWILIO_PHONE_NUMBER ? ' · ' + formatPhone(process.env.DJ_TWILIO_PHONE_NUMBER) : ''}`
    : `Listener line${process.env.TWILIO_PHONE_NUMBER ? ' · ' + formatPhone(process.env.TWILIO_PHONE_NUMBER) : ''}`;

  const group = (name, label) => `
      <div class="ac-group ac-group-${name}${line === name ? ' ac-current' : ''}">
        <span class="ac-group-label">${label}</span>
        ${NAV[name].map((l) => `<a href="${l.href}"${l.key === active ? ' class="ac-active" aria-current="page"' : ''}>${escapeHtml(l.label)}</a>`).join('\n        ')}
      </div>`;

  return `
  <div class="ac-header ac-line-${line}">
    <div class="ac-topbar">
      <span class="ac-line-badge">${escapeHtml(badge)}</span>
      <span class="ac-who">
        ${staff ? 'Signed in as staff' : 'Signed in with the shared login'}
        <form method="POST" action="/admin/logout"><button type="submit" class="ac-logout">Log out</button></form>
      </span>
    </div>
    <h1>${escapeHtml(heading)}</h1>
    ${subtitle ? `<p class="ac-sub">${escapeHtml(subtitle)}</p>` : ''}
    <nav class="ac-nav" aria-label="Admin">
      ${group('listener', 'Listener line')}${staff ? group('dj', 'DJ line') : ''}
    </nav>
  </div>`;
};

module.exports = { adminHeader, CHROME_STYLES, lineForPage, formatPhone };
