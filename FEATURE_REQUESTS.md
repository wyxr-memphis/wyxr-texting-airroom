# WYXR Text App - Feature Requests

This document tracks potential features and enhancements for the WYXR Listener Text App.

---

## Priority 1: Critical Features

### 1. Enable SMS Reply Functionality (Blocked - Waiting on A2P Approval)

**Status:** ⏳ Pending A2P 10DLC Registration Approval (1-2 weeks)

**Description:**
Currently, DJs can see incoming text messages but cannot send replies. The reply functionality is fully implemented in the code but blocked by Twilio until A2P 10DLC registration is approved.

**What's Already Built:**
- ✅ Reply modal with quick reply templates
- ✅ Custom reply text input
- ✅ Backend API endpoint for sending SMS
- ✅ Twilio integration configured
- ✅ Message state updates after reply

**Next Steps (Once A2P Approved):**
1. Verify A2P campaign status in Twilio Console
2. Test SMS sending with a test message
3. Confirm replies appear in listener's phone
4. Train DJs on reply functionality
5. Monitor message delivery rates

**Testing Checklist:**
- [ ] Send reply from DJ dashboard
- [ ] Verify listener receives SMS
- [ ] Confirm reply text is stored in database
- [ ] Check message marked as "replied" in UI
- [ ] Test all 4 quick reply templates
- [ ] Test custom reply text
- [ ] Verify reply shows in admin panel

**Estimated Time:** 30 minutes of testing once approved

---

## Priority 2: Voice Message Integration

### 2. Display Voice Messages in Text App Dashboard

**Status:** 💡 Feature Request

**Description:**
Integrate voice messages from Twilio Flex into the text message dashboard so DJs can see both text and voice messages in one unified interface.

**Current State:**
- Voice messages are handled through Twilio Flex
- Text messages appear in custom WYXR app
- DJs need to check two separate systems

**Desired State:**
- Voice messages appear in the same message grid as texts
- DJs can play voice messages directly in the dashboard
- Keep Twilio Flex for handling incoming calls (no changes to Flex)
- Maintain existing Flex workflow and routing

**Technical Considerations:**

**Option A: Twilio Flex Events + Webhooks**
- Use Twilio Flex webhook to notify our app when voicemail received
- Store recording URL and metadata in our database
- Display voice messages in message grid with audio player
- Pros: Minimal Flex changes, flexible
- Cons: Requires Flex webhook configuration

**Option B: Twilio API Polling**
- Periodically query Twilio API for new recordings
- Fetch recordings and display in dashboard
- Pros: No Flex changes needed
- Cons: Slight delay, API rate limits

**Option C: Twilio Flex Plugin**
- Build custom Flex plugin to send data to our app
- More deeply integrated with Flex UI
- Pros: Real-time, tightly integrated
- Cons: Requires Flex plugin development expertise

**UI Mockup Considerations:**
- Voice message cards should be visually distinct from text messages
- Include audio player with play/pause controls
- Show caller phone number, timestamp, duration
- Allow marking as read/unread (same as texts)
- Allow adding notes/responses (even if can't reply to voice)
- Consider transcription via Twilio Speech-to-Text (optional enhancement)

**Questions to Answer:**
1. Should DJs be able to reply to voice messages via text?
2. Do we need transcription of voice messages?
3. How long should voice messages be stored?
4. Should voice messages have the same 12-hour display window?
5. What metadata from Flex do we need (caller ID, recording URL, duration, etc.)?
6. Do we need caller ID lookup/enrichment?

**Estimated Effort:**
- Research & Planning: 2-4 hours
- Backend Integration: 4-8 hours
- Frontend UI: 4-6 hours
- Testing & QA: 2-4 hours
- **Total: 12-22 hours**

**Dependencies:**
- Access to Twilio Flex configuration
- Twilio account permissions for recording access
- Understanding of current Flex workflow

---

## Priority 3: Moderation & Safety Features

### 3. Phone Number Blocking System

**Status:** ✅ IMPLEMENTED (January 2026)

**Description:**
Allow staff administrators to block phone numbers that send inappropriate or abusive messages. Blocked messages would still be stored in the database for review but would not appear in the DJ dashboard.

**Use Case:**
When a listener sends inappropriate content, station staff (not DJs) can block that number from the admin panel to prevent future messages from appearing on-air or distracting DJs.

**What Was Implemented:**

✅ **Database:**
- `blocked_numbers` table with phone, blocked_at, blocked_by, reason, notes columns
- Migration script for safe production deployment

✅ **Webhook Protection:**
- Incoming messages checked against blocked_numbers table
- Blocked messages stored in database but NOT broadcast to DJ dashboard
- DJs never see messages from blocked numbers

✅ **Admin Panel Features:**
- "Block" button next to each message with modal dialog
- Reason dropdown (Inappropriate content, Spam, Harassment, Other)
- Optional notes field for internal documentation
- "Blocked Numbers" section showing all blocked numbers with details
- "Unblock" button to remove blocks
- Blocked badge on messages from blocked numbers

✅ **Access Control:**
- Only admin panel users can block/unblock (requires authentication)
- DJs have no access to blocking functionality

**Files Modified:**
- `server/db/migrations/003_add_blocked_numbers.sql` - Database schema
- `server/routes/webhook.js` - Block check before broadcast
- `server/routes/admin.js` - Block/unblock endpoints and UI
- `render-migrate.sh` - Migration script for production

**Access:** `/admin/messages` → Click "Block" button next to any message

---

---

## Priority 4: Admin Tools & Reporting

### 4. Message Search & Filtering

**Status:** ✅ IMPLEMENTED (February 2026)

**Description:**
Advanced search and filtering capabilities for the admin panel, allowing staff to find messages by text content, phone number, date range, and status filters. Includes CSV export for record-keeping.

**What Was Implemented:**

✅ **Backend Search API:**
- New endpoint: `GET /admin/messages/search`
- Query parameters:
  - `search` - Full-text search (searches both phone AND message content)
  - `phone` - Filter by specific phone number (exact match)
  - `startDate` / `endDate` - Date range filtering
  - `read` / `replied` - Status filtering
  - `limit` / `offset` - Pagination support
- Returns paginated results with total count
- Secure parameterized SQL queries (SQL injection safe)
- Uses existing database indexes for performance

✅ **Admin Panel Filter UI:**
- Replaced simple search box with comprehensive filter panel
- Text search input (searches message content or phone number)
- Phone number filter (E.164 format)
- Start date and end date pickers
- Read status dropdown (All / Unread Only / Read Only)
- Replied status dropdown (All / Replied / Not Replied)
- Apply Filters button (fetches filtered results from server)
- Clear Filters button (resets all inputs)
- Live result count: "Showing X of Y messages"
- Responsive design (mobile, tablet, desktop)
- WYXR brand colors maintained

✅ **CSV Export Feature:**
- Export CSV button in filter panel
- Downloads filtered messages as CSV file
- Filename includes date: `wyxr-messages-YYYY-MM-DD.csv`
- Columns: ID, Phone, Message, Timestamp, Read, Replied, Reply Text, Blocked
- Proper CSV escaping (quotes, commas, line breaks)
- User feedback alert with count of exported messages
- Prevents empty exports (shows alert if 0 results)
- Supports up to 10,000 messages per export

**Technical Details:**
- Server-side filtering (scalable for thousands of messages)
- Dynamic SQL query building based on active filters
- All filters can be combined together
- Performance: <100ms queries with current indexes
- No new dependencies or environment variables needed

**Use Cases:**
- "Find unread messages from yesterday"
- "Show all messages containing 'song request'"
- "Export all messages from last week to CSV"
- "See which messages we haven't replied to"
- "Find all messages from a specific phone number"

**Files Modified:**
- `server/routes/admin.js` - Added search endpoint, filter UI, CSV export

**Documentation Created:**
- `SEARCH_IMPLEMENTATION_SUMMARY.md` - Technical overview
- `TESTING_SEARCH_FEATURE.md` - Testing guide
- `FEATURE_COMPARISON.md` - Before/after comparison
- `DEPLOYMENT_CHECKLIST.md` - Deployment guide

**Access:** `/admin/messages` → Use filter panel at top of page

---

## Future Enhancement Ideas

### 5. DJ Shift Management
- Track which DJ was on air when message received
- Auto-tag messages with DJ shift info
- Shift handoff notes

### 6. Listener Contact Management
- Save frequent texters as "contacts"
- Add notes about listeners
- Track conversation history per phone number

### 7. Analytics Dashboard
- Messages per hour/day/week
- Most active listeners
- Response time metrics
- Peak messaging times

### 8. Group/Bulk Messaging
- Send announcements to all recent listeners
- Contest notifications to opted-in users
- Emergency station updates

### 9. Auto-Responder
- Automatic "Thanks for texting!" confirmation
- After-hours automated response
- FAQ auto-responses for common questions

### 10. Multi-Station Support
- Support multiple radio stations in one app
- Station-specific branding
- Separate message pools per station

---

## Contributing

Have a feature idea? Add it to this document or discuss with the development team.

**When adding a feature request, include:**
- Clear description of the feature
- Use case / problem it solves
- Priority level (Critical / High / Medium / Low)
- Technical considerations
- Estimated effort (if known)
- Dependencies or blockers

---

**Last Updated:** February 3, 2026
