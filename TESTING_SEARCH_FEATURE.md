# Message Search & Filtering - Testing Guide

## Implementation Complete ✓

The following features have been implemented:

### Backend (Phase 1)
- ✓ New search endpoint: `GET /admin/messages/search`
- ✓ Query parameters: search, phone, startDate, endDate, read, replied, limit, offset
- ✓ Dynamic SQL query building with parameter binding
- ✓ Returns paginated results with total count
- ✓ Includes is_blocked status from blocked_numbers table

### Admin Panel UI (Phase 2)
- ✓ Advanced filter panel replacing simple search box
- ✓ Text search input (searches both phone and message content)
- ✓ Phone number filter input
- ✓ Date range filters (start date, end date)
- ✓ Read status filter (All/Unread Only/Read Only)
- ✓ Replied status filter (All/Replied/Not Replied)
- ✓ Apply Filters button
- ✓ Clear Filters button
- ✓ Result count display (showing X of Y messages)
- ✓ Server-side rendering with real-time updates

### CSV Export (Phase 3)
- ✓ Export CSV button in filter panel
- ✓ Exports all messages matching current filters (up to 10,000)
- ✓ CSV includes: ID, Phone, Message, Timestamp, Read, Replied, Reply Text, Blocked
- ✓ Proper CSV escaping (quotes, commas, line breaks)
- ✓ Filename includes date: `wyxr-messages-YYYY-MM-DD.csv`
- ✓ User feedback alert with count of exported messages

### Styling
- ✓ WYXR brand colors maintained (Yellow #FFC629, Pink #E9407A, Blue #2B9EB3)
- ✓ Responsive design with media queries
- ✓ Consistent button styling (primary, secondary, warning, danger)
- ✓ Filter inputs with brand colors
- ✓ Blocked badge styling

---

## Manual Testing Checklist

### 1. Backend API Testing

**Test Text Search:**
```bash
# Login first to get session cookie, then:
curl "http://localhost:3001/admin/messages/search?search=hello" \
  --cookie "connect.sid=YOUR_SESSION_COOKIE"
```

**Test Phone Filter:**
```bash
curl "http://localhost:3001/admin/messages/search?phone=%2B19015551234" \
  --cookie "connect.sid=YOUR_SESSION_COOKIE"
```

**Test Date Range:**
```bash
curl "http://localhost:3001/admin/messages/search?startDate=2026-02-01&endDate=2026-02-03" \
  --cookie "connect.sid=YOUR_SESSION_COOKIE"
```

**Test Status Filters:**
```bash
curl "http://localhost:3001/admin/messages/search?read=false&replied=true" \
  --cookie "connect.sid=YOUR_SESSION_COOKIE"
```

**Test Pagination:**
```bash
curl "http://localhost:3001/admin/messages/search?limit=10&offset=0" \
  --cookie "connect.sid=YOUR_SESSION_COOKIE"
```

### 2. Admin Panel UI Testing

**Access Admin Panel:**
1. Navigate to `http://localhost:3000`
2. Login with credentials
3. Click "Admin Panel" or navigate to `/admin/messages`

**Test Filter Panel:**
- [ ] Filter panel displays with all inputs
- [ ] Text search input works (searches message content and phone)
- [ ] Phone filter input works (exact match)
- [ ] Start date filter works
- [ ] End date filter works
- [ ] Read status filter works (All/Unread/Read)
- [ ] Replied status filter works (All/Replied/Not Replied)

**Test Filter Combinations:**
- [ ] Apply multiple filters together
- [ ] Text search + date range
- [ ] Phone + read status
- [ ] All filters combined

**Test Buttons:**
- [ ] Apply Filters button fetches and displays results
- [ ] Clear Filters button resets all inputs
- [ ] Clear Filters button shows all messages again
- [ ] Back to App button works

**Test Result Display:**
- [ ] Result count shows correct numbers ("Showing X of Y messages")
- [ ] Messages display in table with correct formatting
- [ ] Blocked messages show "Blocked" badge
- [ ] No JavaScript errors in browser console

### 3. CSV Export Testing

**Test Basic Export:**
- [ ] Click "Export CSV" button
- [ ] File downloads with name `wyxr-messages-YYYY-MM-DD.csv`
- [ ] File opens in spreadsheet software
- [ ] All columns present: ID, Phone, Message, Timestamp, Read, Replied, Reply Text, Blocked

**Test Export with Filters:**
- [ ] Apply text search filter, then export
- [ ] Apply date range filter, then export
- [ ] Apply status filters, then export
- [ ] Exported file contains only filtered messages

**Test Edge Cases:**
- [ ] Export with 0 results shows alert "No messages to export"
- [ ] Export with special characters (quotes, commas) displays correctly
- [ ] Export with line breaks in messages displays correctly
- [ ] Export with large dataset (100+ messages) completes successfully

### 4. Responsive Design Testing

**Desktop (1920x1080):**
- [ ] Filter panel displays in 2-column and 4-column grids
- [ ] Buttons display in horizontal row
- [ ] Table displays without horizontal scroll

**Tablet (768x1024):**
- [ ] Filter inputs stack vertically
- [ ] Buttons stack vertically
- [ ] Table displays with horizontal scroll

**Mobile (375x667):**
- [ ] All filter inputs stack vertically
- [ ] Buttons are full-width
- [ ] Table displays with horizontal scroll

### 5. Integration Testing

**Test with Real Data:**
- [ ] Send test SMS to Twilio number
- [ ] Verify message appears in admin panel
- [ ] Search for the test message
- [ ] Filter by date (today)
- [ ] Filter by unread status
- [ ] Export CSV and verify test message is included

**Test with Blocked Numbers:**
- [ ] Block a phone number
- [ ] Send message from blocked number
- [ ] Verify blocked badge appears in search results
- [ ] Export CSV and verify "Blocked" column shows "Yes"

### 6. Performance Testing

**Test with Large Dataset:**
- [ ] Search with 1000+ messages in database
- [ ] Verify results load within 2 seconds
- [ ] Test pagination (if implemented)
- [ ] Export CSV with 1000+ messages

---

## Known Limitations

1. **Text Search**: Uses ILIKE for case-insensitive search. For very large datasets (10,000+ messages), consider adding GIN index for full-text search.

2. **Date Filters**: Currently date-only (not date-time). Time component defaults to midnight (00:00:00).

3. **CSV Export**: Limited to 10,000 messages to prevent browser crashes. For larger exports, implement server-side CSV generation and download link.

4. **Pagination**: Not yet implemented. All results load at once (up to 100 by default).

---

## Future Enhancements (Out of Scope)

- [ ] Pagination controls (Previous/Next buttons)
- [ ] Saved filter presets
- [ ] Full-text search with GIN index
- [ ] Search autocomplete
- [ ] Export to JSON/Excel formats
- [ ] Advanced query builder UI
- [ ] Date-time pickers (currently date only)
- [ ] DJ Dashboard filters (client-side filtering)

---

## Files Modified

1. `/server/routes/admin.js` - Added search endpoint, updated HTML with filter panel, replaced JavaScript with server-side filtering logic and CSV export

---

## Verification Commands

**Check if search endpoint exists:**
```bash
curl -I "http://localhost:3001/admin/messages/search"
# Should return 401 or 200 (not 404)
```

**Verify database schema:**
```bash
psql wyxr_texts -c "\d messages"
# Should show: id, phone, text, timestamp, read, replied, reply_text, etc.
```

**Check server logs for errors:**
```bash
# Look in terminal where npm run dev is running
# Should not show any SQL errors or 500 responses
```

---

## Troubleshooting

**Issue: "Error loading messages" alert**
- Check browser console for detailed error
- Verify server is running on port 3001
- Check network tab for failed API request
- Verify session cookie is present

**Issue: Filters not working**
- Open browser console and check for JavaScript errors
- Verify fetchMessages() function is defined
- Check if Apply Filters button has click event listener

**Issue: CSV export not downloading**
- Check browser's download settings
- Verify browser allows automatic downloads
- Check browser console for errors

**Issue: Blocked status not showing**
- Verify blocked_numbers table exists
- Check if JOIN query is correct
- Verify is_blocked field in API response

---

## Success Criteria

✓ All backend endpoints respond correctly
✓ Admin panel loads without errors
✓ All filters work individually and in combination
✓ CSV export downloads with correct data
✓ No JavaScript errors in browser console
✓ Responsive design works on all screen sizes
✓ WYXR brand colors maintained throughout
✓ Search performance acceptable (<2 seconds)
