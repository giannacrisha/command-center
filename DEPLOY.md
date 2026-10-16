# Deploying Command Center

The pages run in demo mode (mock data) until `API_URL` in `shared.js` is set. To try them locally, open `index.html` or `phone.html` through any static server. Add `?now=2026-10-15T08:42` to freeze the clock.

## 1. Apps Script backend

1. Create a Google Sheet named **Command Center**.
2. In the Sheet, open **Extensions > Apps Script**. Replace the contents of `Code.gs` with this repo's `Code.gs`, then save.
3. Pick `setup` in the function dropdown and click **Run**. Approve the permissions (Sheets, Calendar, external requests to Cloudflare). This creates the **Tasks** and **Goals** tabs and a secret token.
4. Open **Executions** (left sidebar) and copy the token from the `setup` log. Keep it private, since it's the only thing protecting the API.
5. Set up Cloudflare Workers AI. It's free, needs no card, and Cloudflare doesn't train on your text.
   - Sign up at dash.cloudflare.com, then open **AI > Workers AI**.
   - Click **Use REST API**. Copy the **Account ID**, then click **Create a Workers AI API Token** and copy the token.
   - In Apps Script, open **Project Settings > Script Properties** and add `CF_ACCOUNT_ID` and `CF_API_TOKEN`.
   - The free plan gives 10,000 neurons a day. One sort uses about 85, so that's roughly 100 sorts a day. The count resets at midnight UTC.
6. Fill in the **Goals** tab with one row per category: category, goal, current, target, unit.
7. Edit `CONFIG` at the top of `Code.gs` so events get the right category:
   - `BY_CALENDAR` maps a calendar name to a category.
   - `BY_KEYWORD` lists title words for each category.
   - A `[Career]`-style tag in an event title always wins.
8. Optional: run `testSort` to log the exact prompt and a sample sort. It writes nothing.
9. Click **Deploy > New deployment** and choose type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**. The browser can't send Google sign-in to Apps Script, so the token does the protecting.
10. Copy the URL that ends in `/exec`. Paste it into `API_URL` at the top of `shared.js`.

When you change `Code.gs` later, go to **Deploy > Manage deployments**, click the pencil, set Version to **New version**, and click **Deploy**. The URL stays the same.

## 2. Hosting (GitHub Pages)

The repo holds no secrets. The token stays on your devices, and the API key lives in Script Properties.

```bash
cd ~/projects/command-center
```

```bash
git init -b main && git add . && git commit -m "Command Center"
```

```bash
gh repo create command-center --public --source=. --push
```

```bash
gh api repos/giannacrisha/command-center/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

After a minute the site is live at `https://giannacrisha.github.io/command-center/`. Every later `git push` redeploys it.

## 3. Phone: add to home screen

1. In Safari on the iPhone, open `https://giannacrisha.github.io/command-center/phone.html?token=YOUR_TOKEN`.
2. Tap **Share > Add to Home Screen > Add**.
3. Open the new icon. Home-screen apps keep their own storage, separate from Safari, so the first launch may ask for the token. Paste it once.
4. In Wispr Flow, make sure its keyboard is enabled (**Settings > General > Keyboard > Keyboards**). On the Capture tab, switch to it with the globe key.

## 4. Fire TV: Fully Kiosk Browser

Menu names vary a little between Fully Kiosk versions.

| Setting | Where | Value |
|---|---|---|
| Start URL | Web Content Settings | `https://giannacrisha.github.io/command-center/?token=YOUR_TOKEN` |
| Keep screen on | Device Management | On |
| Launch on boot | Device Management | On |
| Auto reload after page error | Web Auto Reload | On |
| Auto reload on network reconnect | Web Auto Reload | On |
| Auto reload on idle | Web Auto Reload | 3600 seconds (fresh page every hour) |
| Enable zoom | Web Zoom and Scaling | Off (the page scales itself) |
| Screen off overnight | Power Settings > Scheduled Sleep / Wakeup | Sleep 00:00, wake 07:00 (PLUS license) |

The remote's d-pad works as follows: left and right switch between Day and Week, and the center button returns to today's Day view. The TV only reads data. It never writes, sends or deletes anything.

## What writes where

| Action | Writes |
|---|---|
| Phone: check a task | Tasks tab: `done` and `done on` for that row |
| Phone: update a goal | Goals tab: `current` for that row |
| Phone: Sort my day | Nothing. It only calls Workers AI and returns proposals. |
| Phone: Approve | New events on the "Command Center" calendar, new rows in the Tasks tab |

Nothing is ever deleted or sent.
