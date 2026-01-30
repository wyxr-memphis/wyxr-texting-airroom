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

## Future Enhancement Ideas

### 3. Message Search & Filtering
- Search messages by phone number, text content, or date range
- Filter by read/unread, replied/not replied
- Export messages to CSV

### 4. DJ Shift Management
- Track which DJ was on air when message received
- Auto-tag messages with DJ shift info
- Shift handoff notes

### 5. Listener Contact Management
- Save frequent texters as "contacts"
- Add notes about listeners
- Track conversation history per phone number

### 6. Analytics Dashboard
- Messages per hour/day/week
- Most active listeners
- Response time metrics
- Peak messaging times

### 7. Scheduled Messages
- Schedule automated station announcements
- Birthday/event reminders for listeners
- Contest notifications

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

**Last Updated:** January 29, 2026
