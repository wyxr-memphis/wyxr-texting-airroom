// HTML escaping for server-rendered admin pages.
//
// Extracted from routes/admin.js so every page that interpolates user- or
// staff-supplied text into HTML shares one implementation. Broadcast bodies
// are staff free text echoed back onto the status and history pages, which
// makes this the same stored-XSS surface the admin phone values were.
const escapeHtml = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

module.exports = { escapeHtml };
