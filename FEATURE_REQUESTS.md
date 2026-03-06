# WYXR Text App - Feature Requests

This document tracks potential features and enhancements for the WYXR Listener Text App.

---

## Priority 1: Critical Features

### 1. Enable SMS Reply Functionality

**Status:** ✅ Live — A2P 10DLC Approved March 5, 2026

**Description:**
Currently, DJs can see incoming text messages but cannot send replies. The reply functionality is fully implemented in the code but blocked by Twilio until A2P 10DLC registration is approved.

**What's Already Built:**
- ✅ Reply modal with quick reply templates
- ✅ Custom reply text input
- ✅ Backend API endpoint for sending SMS
- ✅ Twilio integration configured
- ✅ Message state updates after reply

**Completed Steps:**
1. ✅ A2P campaign approved in Twilio Console (March 5, 2026)
2. ✅ Reply button enabled in ConversationThread component
3. ✅ SMS replies sending and delivering to listeners
4. ✅ DJs can use quick reply templates or custom text
5. ✅ Monitoring message delivery rates via Twilio console

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

### 1b. SMS Auto-Reply Opt-In System (TCPA/A2P Compliance)

**Status:** ✅ Implemented — Live in Production

**Description:**
Implement automated two-stage opt-in flow that requests explicit consent before enabling DJ replies, ensuring full TCPA and A2P 10DLC compliance. When a listener texts WYXR for the first time, DJs cannot legally reply without explicit prior consent. Receiving a text FROM someone does not grant permission to text them back under TCPA regulations.

---

#### Problem Statement

Current SMS system violates A2P 10DLC compliance: when a listener texts WYXR for the first time, DJs cannot legally reply without explicit prior consent. The existing reply functionality (currently blocked) assumes that incoming messages grant permission to reply, which is incorrect under TCPA regulations.

---

#### Solution Overview

Implement automated two-stage opt-in flow:
1. **First Contact:** Listener texts → System sends opt-in request → Message held as "pending"
2. **Confirmation:** Listener replies "YES" → System confirms → Original message forwarded to DJ dashboard → Replies enabled

This maintains the spontaneous feel of live radio interaction while meeting legal requirements.

---

#### Use Cases

**Use Case 1: New Listener First Contact**
- **Actor:** Listener (first-time texter)
- **Trigger:** Listener texts any message to 901-460-3031
- **Flow:**
  1. Listener texts: "I love that song!"
  2. System automatically sends opt-in request: "Welcome to WYXR 91.7 FM! To chat with our DJs and get show updates, reply YES to confirm. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out, HELP for help. Privacy: wyxr.org/privacy"
  3. System stores listener's original message as "pending"
  4. System shows listener in dashboard "Pending Opt-In" section (DJ cannot reply yet)
- **Expected Outcome:** Listener receives opt-in request, original message saved, appears in pending list

**Use Case 2: Listener Confirms Opt-In**
- **Actor:** Listener (pending confirmation)
- **Trigger:** Listener replies "YES" (or Y, CONFIRM, OK, SURE)
- **Flow:**
  1. Listener replies: "YES"
  2. System automatically sends confirmation: "You're all set! Our DJs can now respond to your texts. You'll also get program updates & community alerts from WYXR 91.7 FM. Msg frequency varies. Reply STOP anytime to opt out. wyxr.org"
  3. System marks listener as opted-in with timestamp
  4. System forwards original message ("I love that song!") to dashboard Active section with "Original Message" badge
  5. DJ can now see message and reply button is enabled
- **Expected Outcome:** Listener confirmed and active, original message visible to DJ, replies now enabled

**Use Case 3: DJ Replies to Opted-In Listener**
- **Actor:** DJ
- **Trigger:** DJ clicks reply on message from opted-in listener
- **Flow:**
  1. DJ sees message in Active section with green ✅ "Opted In" badge
  2. DJ types reply: "Thanks! That's 'Respect' by Aretha Franklin. Glad you're loving it!"
  3. DJ clicks Send
  4. System verifies listener is opted-in
  5. Message sent via Twilio
  6. Listener receives DJ's reply
- **Expected Outcome:** Reply delivered successfully, conversation continues

**Use Case 4: DJ Attempts Reply to Non-Opted-In Listener**
- **Actor:** DJ
- **Trigger:** DJ tries to reply to pending listener
- **Flow:**
  1. DJ sees message in Pending section with yellow ⚠️ indicator
  2. Reply button is disabled/grayed out
  3. Message shows: "Waiting for opt-in confirmation..."
  4. If DJ somehow attempts to send (API call), returns 403 error
- **Expected Outcome:** Reply blocked, DJ sees clear indicator that opt-in is required

**Use Case 5: Listener Texts Again Before Confirming**
- **Actor:** Listener (pending confirmation)
- **Trigger:** Listener sends another message without replying YES
- **Flow:**
  1. Listener texts: "What's the station frequency?"
  2. System updates pending message to new text
  3. System sends reminder: "Hey! To chat with WYXR DJs, please reply YES to confirm. Thanks!"
  4. Dashboard shows updated message in Pending section
- **Expected Outcome:** Pending message updated, reminder sent, still requires YES confirmation

**Use Case 6: Listener Opts Out Before Confirming**
- **Actor:** Listener (pending confirmation)
- **Trigger:** Listener replies "STOP"
- **Flow:**
  1. Listener replies: "STOP"
  2. System marks as opted-out (never completed opt-in)
  3. System sends: "WYXR 91.7 FM: You're unsubscribed. No more messages will be sent. You can still listen at wyxr.org! Reply START to rejoin anytime."
  4. System removes from pending list
  5. Future texts from this number should re-trigger opt-in flow
- **Expected Outcome:** Listener opted out, removed from system, can re-initiate later

**Use Case 7: Already Opted-In Listener Says YES Again**
- **Actor:** Listener (already active)
- **Trigger:** Opted-in listener texts "YES"
- **Flow:**
  1. Listener texts: "YES"
  2. System detects already opted-in status
  3. System sends friendly confirmation: "You're all set! You're already receiving WYXR messages."
  4. Message forwarded to DJ as normal conversation message
- **Expected Outcome:** Friendly acknowledgment, no duplicate opt-in processing

**Use Case 8: Web Form Opt-In (Future Enhancement)**
- **Actor:** Listener (via website)
- **Trigger:** Listener visits wyxr.org/text and submits form
- **Flow:**
  1. Listener enters phone number and checks opt-in box
  2. Form submission creates contact with opted_in=true, method='web'
  3. System sends confirmation message
  4. Listener can immediately text DJs (already opted in)
- **Expected Outcome:** Listener pre-opted-in via web, can text immediately

---

#### Functional Requirements

**Database:**
- **FR-1:** Store contact records with: phone_number (unique), opted_in (boolean), opt_in_method, opt_in_timestamp, pending_message, pending_timestamp
- **FR-2:** Log all opt-in actions with: phone_number, action type, method, user_message, system_response, timestamp
- **FR-3:** Track first contact timestamp and last message timestamp per contact

**Incoming Message Processing:**
- **FR-4:** Check if incoming phone number exists in contacts table
- **FR-5:** If new contact: create record, store message as pending, send opt-in request, add to dashboard pending list
- **FR-6:** If pending contact receives YES: mark opted-in, send confirmation, forward original message to dashboard
- **FR-7:** If pending contact sends different message: update pending message, send reminder
- **FR-8:** If opted-in contact sends message: forward to dashboard normally

**Outbound Message Validation:**
- **FR-9:** Before sending DJ reply, verify contact exists and opted_in=true
- **FR-10:** Block sending if contact not opted-in, return error to dashboard
- **FR-11:** Log all successful outbound messages with DJ info

**Dashboard Display:**
- **FR-12:** Show two distinct sections: "Pending Opt-In" (yellow theme) and "Active Conversations" (green theme)
- **FR-13:** Pending section: show phone, message, time elapsed, disabled reply interface, warning indicator
- **FR-14:** Active section: show phone, message, time elapsed, enabled reply interface, opt-in badge
- **FR-15:** Mark forwarded original messages with "Original Message" badge
- **FR-16:** Real-time updates when pending contacts become active

**Automated Messages:**
- **FR-17:** Send opt-in request message immediately when new contact texts
- **FR-18:** Send opt-in confirmation message when YES received
- **FR-19:** Send reminder message if pending contact texts again without YES
- **FR-20:** Support standard STOP (opt-out) and HELP keywords

**Migration/Legacy Data:**
- **FR-21:** Backfill existing contacts from current message database
- **FR-22:** Mark all legacy contacts as opted_in=true with method='legacy'
- **FR-23:** Preserve existing functionality for already-active conversations

---

#### Non-Functional Requirements

**Performance:**
- **NFR-1:** Opt-in request sent within 1 second of receiving first message
- **NFR-2:** Dashboard updates within 2 seconds of opt-in confirmation
- **NFR-3:** Support 50+ concurrent DJ sessions

**Compliance:**
- **NFR-4:** Meet A2P 10DLC and TCPA opt-in requirements
- **NFR-5:** Log all opt-in records for minimum 4 years (regulatory audit)
- **NFR-6:** Store opt-in method, timestamp, and original consent message

**Usability:**
- **NFR-7:** Clear visual distinction between pending and active contacts
- **NFR-8:** Obvious indicators preventing DJ from replying to non-opted-in contacts
- **NFR-9:** Average opt-in confirmation rate target: >80%
- **NFR-10:** Average time to confirmation target: <5 minutes

**Reliability:**
- **NFR-11:** No loss of pending messages during opt-in process
- **NFR-12:** Graceful handling of duplicate YES confirmations
- **NFR-13:** Prevent race conditions if DJ attempts reply during opt-in confirmation

---

#### Message Templates Required

These exact messages must be implemented:

**OPT_IN_REQUEST:**
```
Welcome to WYXR 91.7 FM! To chat with our DJs and get show updates, reply YES to confirm. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out, HELP for help. Privacy: wyxr.org/privacy
```

**OPT_IN_CONFIRMATION:**
```
You're all set! Our DJs can now respond to your texts. You'll also get program updates & community alerts from WYXR 91.7 FM. Msg frequency varies. Reply STOP anytime to opt out. wyxr.org
```

**OPT_IN_REMINDER:**
```
Hey! To chat with WYXR DJs, please reply YES to confirm. Thanks!
```

**OPT_OUT_CONFIRMATION:**
```
WYXR 91.7 FM: You're unsubscribed. No more messages will be sent. You can still listen at wyxr.org! Reply START to rejoin anytime.
```

**ALREADY_OPTED_IN:**
```
You're all set! You're already receiving WYXR messages.
```

---

#### Key Business Rules

1. **BR-1:** Only contacts with opted_in=true can receive messages from DJs
2. **BR-2:** Original message must be preserved and forwarded after opt-in confirmation
3. **BR-3:** YES confirmation variants accepted: YES, Y, CONFIRM, OK, SURE (case-insensitive)
4. **BR-4:** Pending contacts can send multiple messages; only most recent is stored and forwarded
5. **BR-5:** STOP keyword immediately opts out, even if not yet opted in
6. **BR-6:** Legacy contacts (from before this system) automatically marked opted-in
7. **BR-7:** Web form opt-ins bypass the YES confirmation flow (already consented)

---

#### Success Criteria

- **SC-1:** No DJ replies sent to non-opted-in contacts (100% enforcement)
- **SC-2:** Opt-in confirmation rate ≥80% within first 24 hours
- **SC-3:** Zero complaints about broken opt-in flow in first week
- **SC-4:** Average opt-in confirmation time <5 minutes
- **SC-5:** All opt-in records logged with timestamp and method
- **SC-6:** Dashboard clearly distinguishes pending vs. active contacts
- **SC-7:** DJs understand new flow after single training session

---

#### Edge Cases to Handle

1. User texts again before confirming → Update pending message, send reminder
2. User texts STOP before opting in → Mark opted-out, remove from pending
3. User replies YES when already opted-in → Send friendly confirmation, treat as normal message
4. User texts from shortcode (5-digit) → Error message about 10-digit requirement
5. Multiple DJs view same pending contact → All see same status, first to respond after opt-in wins
6. User texts during off-air hours → Still send opt-in request, message waits for DJ

---

#### Database Schema Changes Required

**New Table: `contacts`**
```sql
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  opted_in BOOLEAN DEFAULT false,
  opt_in_method VARCHAR(20), -- 'sms', 'web', 'legacy'
  opt_in_timestamp TIMESTAMP,
  pending_message TEXT,
  pending_timestamp TIMESTAMP,
  first_contact_timestamp TIMESTAMP DEFAULT NOW(),
  last_message_timestamp TIMESTAMP,
  opted_out BOOLEAN DEFAULT false,
  opted_out_timestamp TIMESTAMP
);

CREATE INDEX idx_contacts_phone ON contacts(phone_number);
CREATE INDEX idx_contacts_opted_in ON contacts(opted_in);
```

**New Table: `opt_in_log`**
```sql
CREATE TABLE opt_in_log (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- 'request', 'confirm', 'reminder', 'opt_out', etc.
  method VARCHAR(20), -- 'sms', 'web'
  user_message TEXT,
  system_response TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_opt_in_log_phone ON opt_in_log(phone_number);
CREATE INDEX idx_opt_in_log_timestamp ON opt_in_log(timestamp);
```

---

#### Files That Will Require Changes

**Backend:**
- `server/routes/webhook.js` - Add opt-in flow logic, keyword detection (YES, STOP, HELP)
- `server/routes/messages.js` - Update to handle pending vs. active messages
- `server/routes/reply.js` - Add opt-in verification before sending (or create new route)
- `server/db/schema.sql` - Add contacts and opt_in_log tables
- `server/db/migrations/` - New migration scripts
- `server/utils/twilio.js` - Add automated message sending functions

**Frontend:**
- `client/src/App.jsx` - Update state to separate pending/active messages
- `client/src/components/MessageCard.jsx` - Add opt-in badges, disable reply for pending
- `client/src/components/MessageList.jsx` - Create separate sections for pending/active
- `client/src/components/ReplyModal.jsx` - Add opt-in verification check
- `client/src/styles/` - New styles for pending section (yellow theme)

**Admin Panel:**
- `server/routes/admin.js` - Add contacts view, manual opt-in override (future)

---

#### Implementation Phases

**Phase 1: Database & Backend Core (Priority)**
- Create contacts and opt_in_log tables
- Update webhook to check contact status
- Implement automated opt-in messages
- Add keyword detection (YES, STOP, HELP)
- Backfill legacy contacts

**Phase 2: Dashboard UI Updates**
- Split message view into Pending/Active sections
- Add opt-in badges and indicators
- Disable reply button for pending contacts
- Real-time updates for opt-in confirmations

**Phase 3: Reply Validation**
- Update reply endpoint to verify opt-in status
- Add error handling for non-opted-in attempts
- Update ReplyModal with opt-in warnings

**Phase 4: Testing & Refinement**
- End-to-end testing with test phone numbers
- Verify compliance with legal requirements
- Train DJs on new workflow
- Monitor opt-in conversion rates

---

#### Integration with Existing Reply Functionality

**Current State:**
- Reply button shown in `ConversationThread.jsx` only for opted-in contacts
- Reply modal and backend endpoints fully implemented and live
- A2P approved, SMS replies sending successfully

**Integration Points:**
- Reply button shown ONLY for opted-in contacts
- Pending contacts see "Waiting for opt-in" status
- Backend validates opt-in status before sending ANY reply
- Legacy contacts (existing messages) automatically marked opted-in
- No disruption to current read/unread/replied workflow

**Key Integration Points:**
1. `server/routes/webhook.js` - First point of contact, determines opt-in flow
2. `server/routes/messages.js` - Returns messages with opt-in status for frontend filtering
3. `client/src/components/MessageCard.jsx` - Conditionally shows/hides reply button based on opt-in
4. `client/src/hooks/useWebSocket.js` - Handles real-time opt-in status updates

---

#### Out of Scope (Future Enhancements)

- Admin panel for manual opt-in override
- Bulk messaging to all opted-in contacts
- Analytics dashboard for opt-in metrics
- A/B testing different opt-in message wording
- Automatic re-engagement campaigns for abandoned opt-ins
- Web form opt-in page at wyxr.org/text

---

#### Dependencies & Blockers

**Blockers:**
- ✅ A2P 10DLC approved March 5, 2026 — no remaining blockers

**Dependencies:**
- Existing Twilio integration (already configured)
- Existing reply functionality (already built, just commented out)
- PostgreSQL database (already deployed)
- Session authentication (already working)

---

#### Estimated Effort

- **Database Schema & Migrations:** 2-3 hours
- **Backend Opt-In Logic:** 6-8 hours
- **Frontend Dashboard Updates:** 6-8 hours
- **Reply Validation & Error Handling:** 2-3 hours
- **Testing & QA:** 4-6 hours
- **Documentation & Training:** 2-3 hours
- **Total Estimated Effort:** 22-31 hours (3-4 full dev days)

---

#### Questions to Answer Before Implementation

1. Should we allow manual opt-in override in admin panel? (e.g., if listener calls station)
2. How long should pending messages wait before auto-expiring? (24 hours? 7 days?)
3. Should we send follow-up reminder if no YES received after X hours?
4. Do we need HELP keyword auto-response? If so, what should it say?
5. Should web form opt-in be part of initial release or Phase 2?
6. What analytics/reporting do we need for opt-in conversion rates?

---

**Next Steps Once A2P Approved:**
1. Review and finalize this specification
2. Create detailed implementation plan
3. Set up staging/test environment
4. Begin Phase 1 (Database & Backend Core)
5. Coordinate with station management for DJ training

---

**Related Documentation:**
- CLAUDE.md - Project overview and architecture
- ARCHITECTURE.md - System design and data flow
- server/routes/webhook.js - Current Twilio webhook implementation
- server/routes/reply.js - Existing reply functionality (commented out)

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

**Last Updated:** March 6, 2026
