# Command Center: Spec

Personal dashboard with two clients on one backend:
1. TV view (`index.html`) for an Insignia Fire TV running Fully Kiosk Browser.
2. Phone view (`phone.html`) installed to the iPhone home screen.

## Design source
Figma: https://www.figma.com/design/12Uoz3K7TCzOjrmGNqBON5
- "A2 · Day view" (node-id=6-47)
- "A2 · Week view" (node-id=7-47)
- "Phone · Morning capture" (node-id=8-175)

## Stack
- `index.html` and `phone.html`, inline CSS and JS. No framework, no build step, no dependencies.
- One Google Apps Script web app (`Code.gs`) reading/writing Google Calendar and a Google Sheet, returning JSON. Secret token in the query string.
- Extend the existing Command Queue Sheet and Apps Script if they exist.
- Host on GitHub Pages or Cloudflare Pages, whichever is simpler.

## Shared visual specs
- Fonts: Lora SemiBold (headings), Atkinson Hyperlegible Next (body), Google Fonts.
- Light: bg #fffdfa, text #3d2f1f, heading #90642f, card #ffffff, muted #6B5234, soft #EDE5D8, border #E8DCC8, grid #F1EADF, now line #e5534b.
- Dark: bg #1a1a1a, text #e8e0d0, heading #d8af78, card #242424.
- Goal colors (fill / accent):
  - Academic #DCE6F0 / #3F5F80
  - Career #F3E7C4 / #7A5B12
  - Social #F5DCC8 / #8A4A22
  - Personal #E2EAD8 / #4C6B3F
- Every event, task, and goal is tagged with one of the four categories.
- Cards: 24px radius, shadow `0 4px 16px rgba(144,100,47,.12)`.
- Events: Google Calendar style, goal-color fill, 4px left accent bar.

## Data (Apps Script)
- Events: this week's calendars. Category by calendar or `[Category]` title tag; rule easy to edit.
- Sheet "Tasks": task, category, done, due, minutes.
- Sheet "Goals": category, goal, current, target, unit.
- Endpoints: GET dashboard; POST task done; POST goal progress; POST sort (Claude call); POST approve (writes tasks and calendar blocks).

## TV view (index.html)
- Fixed 1280x720 stage, 44px side padding for overscan, scaled by CSS transform to the viewport. Never reflows or scrolls.
- Day view: top bar (Today pill, arrows, date title, Day/Week switcher, clock); left sidebar (mini month with today circled, Today's list with checkboxes and goal dots); center hour grid 8am-8pm with now line; right column of 4 goal cards (label, goal, progress bar, "X of Y").
- Week view: Sun-Sat grid, today circled, past days at 55% opacity, goals strip along the bottom.
- Auto-cycle Day/Week every 30s. ArrowLeft/ArrowRight switch and reset timer. Enter jumps to Today.
- Dark palette 9pm-7am. Data refresh every 5 min, clock every 30s.
- "Synced X min ago." On fetch failure keep last good data.
- Read-only: never writes, sends, or deletes.

## Phone view (phone.html)
- Manifest + apple-touch-icon. 44px min tap targets. Test at 390x844.
- Tabs: Today (agenda + task checkboxes that write done), Week (7-day list by day), Goals (tap card to update progress), Capture (Figma frame: big autofocused textarea for Wispr Flow, "Sort my day" button).

## Sort flow
1. Apps Script sends text to the Claude API. Key in Script Properties. Current Sonnet model string.
2. Claude returns JSON tasks: title, category, estimated minutes.
3. Tasks of 30+ min get proposed blocks in free slots between now and 10pm, avoiding events, 10 min buffers.
4. Shorter tasks go on the list.
5. Proposals shown as dashed, editable, removable blocks.
6. "Approve" is the only action that writes to Calendar and Tasks. Nothing sent or deleted.

## Workflow
1. Short plan first.
2. Build both views with mock data. Screenshot TV at 1280x720, phone at 390x844.
3. Wire up Apps Script, Claude call last. Show the exact prompt.
4. Deploy instructions: Apps Script, hosting, home screen install, Fully Kiosk (start URL, keep screen on, auto reload, launch on boot).

## Plan amendments (agreed 2026-10-15)
1. Token: never committed. Pages read `?token=` once, save to localStorage, strip it from the URL. Fully Kiosk start URL carries it.
2. CORS: POST bodies sent as `text/plain` (no preflight); Code.gs parses JSON from `e.postData.contents`.
3. Approve is idempotent: each proposal has an ID, server skips IDs already written, button locks while in flight.
4. Approved blocks go to a dedicated "Command Center" calendar with `[Category]` in the title.
5. Fully Kiosk screen-off schedule overnight (e.g. 12am-7am) to limit burn-in.
6. CacheService on the dashboard GET (~60s TTL); writes bust the cache.
7. Claude call uses structured output constrained to the 4 categories; current goals included as context.
8. TV: arrows and Today pill stay visual; Left/Right switch views, Enter returns to Day view of today.

## Design v2 (Claude Design canvas: https://claude.ai/artifact/UM9JJSwVcTGYuE1Nqnhdzs)
Supersedes the Figma frames where they differ.
- TV type floor: 14px labels, 17px event and list text, 38px title and clock (sized for couch distance).
- Day: "Up next" card at top left with countdown; mini month moved to the bottom; Today's list uses category-colored rings in place of checkbox + dot; summary line shows free time; footer shows view-cycle progress and "Synced X min ago".
- Week: no times inside cells, 15px titles, today's column tinted, goals strip uses "X of Y".
- Night (after 8pm): shows tomorrow's agenda, carried-over tasks and goals in the dark palette; footer notes screen-off time.
- Phone Capture: mic button removed (Wispr Flow is the keyboard); textarea and "Sort my day" sit above the keyboard; Approve moved to Review.
- Phone Review: rest of today as a list with existing events solid and proposals dashed, edit/remove 44px buttons, quick tasks list, sticky "Approve N blocks and M tasks" above the tab bar.

## Build notes
- Shared logic lives in `shared.js` (config, token, API, mock data) so both pages stay in sync.
- No existing Command Queue Sheet was found in Drive, so `Code.gs` is a fresh script bound to a new "Command Center" Sheet.
- Tasks tab gets a sixth column, "done on", so tasks finished today stay on today's list.
- Approve also adds each approved block to the Tasks tab (due today) so it can be checked off.
- Sort call uses Cloudflare Workers AI's free tier (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON mode) instead of Claude. About 85 of the 10,000 free daily neurons per sort. CF_ACCOUNT_ID and CF_API_TOKEN in Script Properties. Cloudflare does not train on Workers AI inputs.
