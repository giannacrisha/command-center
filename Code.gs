/**
 * Command Center backend: one Apps Script web app bound to the Command Center Google Sheet.
 * Reads Google Calendar and the Tasks/Goals tabs, returns JSON, and writes only on taskDone,
 * goalProgress and approve. Nothing is ever deleted or sent.
 *
 * Script Properties: TOKEN (created by setup) and ANTHROPIC_API_KEY.
 */

// ---------- edit these ----------
const CONFIG = {
  // Calendars to read, by name. Empty = every calendar you own.
  CALENDARS: [],
  // Approved blocks are written here. Created on the first approve.
  BLOCKS_CALENDAR: 'Command Center',

  // Category rules, checked in this order:
  //   1. a [Category] tag in the event title, e.g. "[Career] Coffee chat"
  //   2. the calendar the event is on
  //   3. keywords in the title (whole words, any case)
  //   4. DEFAULT_CATEGORY
  BY_CALENDAR: {
    // 'Brandeis Classes': 'Academic',
  },
  BY_KEYWORD: {
    Academic: ['ANTH', 'COSI', 'BUS', 'class', 'lecture', 'seminar', 'exam', 'study'],
    Career: ['TA', 'BDI', 'interview', 'lab hours', 'office hours', 'internship', 'recruiter'],
    Social: ['DeisHacks', 'GWC', 'dinner', 'party', 'hangout', 'consulting'],
    Personal: ['gym', 'push day', 'pull day', 'leg day', 'run', 'doctor', 'haircut'],
  },
  DEFAULT_CATEGORY: 'Personal',

  DAY_END_HOUR: 22,      // proposals stop at 10pm
  BUFFER_MIN: 10,        // gap kept around events and blocks
  BLOCK_MIN_MINUTES: 30, // tasks this long or longer get a time block
  MODEL: 'claude-sonnet-5-5',
  CACHE_SECONDS: 60,
};

const CATS = ['Academic', 'Career', 'Social', 'Personal'];

// ---------- one-time setup: run from the editor ----------
function setup() {
  const ss = SpreadsheetApp.getActive();
  const tabs = {
    Tasks: ['task', 'category', 'done', 'due', 'minutes', 'done on'],
    Goals: ['category', 'goal', 'current', 'target', 'unit'],
  };
  Object.entries(tabs).forEach(([name, head]) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (!sh.getRange(1, 1).getValue()) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const tasks = ss.getSheetByName('Tasks');
  tasks.getRange('C2:C').insertCheckboxes();
  const cats = SpreadsheetApp.newDataValidation().requireValueInList(CATS).build();
  tasks.getRange('B2:B').setDataValidation(cats);
  ss.getSheetByName('Goals').getRange('A2:A').setDataValidation(cats);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Your token: ' + props.getProperty('TOKEN'));
  if (!props.getProperty('ANTHROPIC_API_KEY')) Logger.log('Add ANTHROPIC_API_KEY in Project Settings > Script Properties.');
}

// ---------- web app ----------
function doGet(e) {
  return respond(e, () => {
    if (e.parameter.action === 'dashboard') return dashboard();
    throw new Error('Unknown action');
  });
}

function doPost(e) {
  return respond(e, () => {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'taskDone': return taskDone(body);
      case 'goalProgress': return goalProgress(body);
      case 'sort': return sort(body);
      case 'approve': return approve(body);
      default: throw new Error('Unknown action');
    }
  });
}

function respond(e, fn) {
  let out;
  try {
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || e.parameter.token !== token) throw new Error('Unauthorized');
    out = fn();
  } catch (err) {
    out = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- reads ----------
function dashboard() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('dash');
  if (hit) return JSON.parse(hit);

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 8); // +1 day so Saturday night can show Sunday
  const out = { events: readEvents(start, end), tasks: readTasks(), goals: readGoals(), syncedAt: now.toISOString() };
  try { cache.put('dash', JSON.stringify(out), CONFIG.CACHE_SECONDS); } catch (err) { /* over 100KB: skip caching */ }
  return out;
}

function calendars() {
  if (!CONFIG.CALENDARS.length) return CalendarApp.getAllOwnedCalendars();
  return CONFIG.CALENDARS.concat(CONFIG.BLOCKS_CALENDAR).flatMap(n => CalendarApp.getCalendarsByName(n));
}

function readEvents(start, end) {
  const seen = {};
  const events = [];
  calendars().forEach(cal => {
    cal.getEvents(start, end).forEach(ev => {
      const key = ev.getId() + ev.getStartTime().getTime();
      if (seen[key]) return;
      seen[key] = true;
      try { if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (err) { /* not a guest */ }
      const { title, category } = categorize(ev.getTitle(), cal.getName());
      events.push({
        id: ev.getId(),
        title,
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        category,
        location: ev.getLocation() || '',
      });
    });
  });
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

function categorize(rawTitle, calName) {
  const tag = rawTitle.match(/\[(academic|career|social|personal)\]/i);
  if (tag) {
    const category = CATS.find(c => c.toLowerCase() === tag[1].toLowerCase());
    return { title: rawTitle.replace(tag[0], '').replace(/\s+/g, ' ').trim(), category };
  }
  if (CONFIG.BY_CALENDAR[calName]) return { title: rawTitle, category: CONFIG.BY_CALENDAR[calName] };
  for (const cat of CATS) {
    const hit = (CONFIG.BY_KEYWORD[cat] || []).some(k =>
      new RegExp('(^|\\W)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\W|$)', 'i').test(rawTitle));
    if (hit) return { title: rawTitle, category: cat };
  }
  return { title: rawTitle, category: CONFIG.DEFAULT_CATEGORY };
}

function table(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error(`Missing "${name}" tab. Run setup().`);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(h => String(h).trim().toLowerCase());
  return { sh, values, col: k => head.indexOf(k) };
}

function ymd(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

function readTasks() {
  const t = table('Tasks');
  const c = { task: t.col('task'), cat: t.col('category'), done: t.col('done'), due: t.col('due'), min: t.col('minutes'), on: t.col('done on') };
  return t.values.slice(1).map((r, i) => ({
    row: i + 2,
    task: String(r[c.task]).trim(),
    category: CATS.includes(r[c.cat]) ? r[c.cat] : CONFIG.DEFAULT_CATEGORY,
    done: r[c.done] === true || String(r[c.done]).toLowerCase() === 'true',
    due: ymd(r[c.due]),
    minutes: Number(r[c.min]) || 0,
    doneOn: c.on >= 0 ? ymd(r[c.on]) : '',
  })).filter(x => x.task);
}

function readGoals() {
  const t = table('Goals');
  const c = { cat: t.col('category'), goal: t.col('goal'), cur: t.col('current'), tgt: t.col('target'), unit: t.col('unit') };
  return t.values.slice(1).map((r, i) => ({
    row: i + 2,
    category: CATS.includes(r[c.cat]) ? r[c.cat] : CONFIG.DEFAULT_CATEGORY,
    goal: String(r[c.goal]).trim(),
    current: Number(r[c.cur]) || 0,
    target: Number(r[c.tgt]) || 1,
    unit: String(r[c.unit] || ''),
  })).filter(x => x.goal);
}

// ---------- writes ----------
// Each write checks the row still holds what the phone saw, so a re-sorted sheet can't get the wrong row edited.
function taskDone({ row, task, done }) {
  const t = table('Tasks');
  if (String(t.values[row - 1]?.[t.col('task')] ?? '').trim() !== task) throw new Error('The sheet changed. Refresh and try again.');
  t.sh.getRange(row, t.col('done') + 1).setValue(!!done);
  if (t.col('done on') >= 0) t.sh.getRange(row, t.col('done on') + 1).setValue(done ? new Date() : '');
  bust();
  return { ok: true };
}

function goalProgress({ row, goal, current }) {
  const t = table('Goals');
  if (String(t.values[row - 1]?.[t.col('goal')] ?? '').trim() !== goal) throw new Error('The sheet changed. Refresh and try again.');
  if (typeof current !== 'number' || !isFinite(current)) throw new Error('Progress must be a number');
  t.sh.getRange(row, t.col('current') + 1).setValue(current);
  bust();
  return { ok: true };
}

// The only action that writes to Calendar or appends tasks. Idempotent per proposal id.
function approve({ blocks = [], tasks = [] }) {
  if (blocks.length > 20 || tasks.length > 40) throw new Error('Too many items');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cache = CacheService.getScriptCache();
    const fresh = x => x && x.id && !cache.get('ap:' + x.id);
    const cal = CalendarApp.getCalendarsByName(CONFIG.BLOCKS_CALENDAR)[0] || CalendarApp.createCalendar(CONFIG.BLOCKS_CALENDAR);
    const t = table('Tasks');
    const today = ymd(new Date());
    let made = 0, added = 0;

    const addTask = (title, category, minutes) => {
      const row = [];
      row[t.col('task')] = title;
      row[t.col('category')] = category;
      row[t.col('done')] = false;
      row[t.col('due')] = today;
      row[t.col('minutes')] = minutes;
      if (t.col('done on') >= 0) row[t.col('done on')] = '';
      t.sh.appendRow(Array.from(row, v => v ?? ''));
      added++;
    };

    blocks.filter(fresh).forEach(b => {
      const category = CATS.includes(b.category) ? b.category : CONFIG.DEFAULT_CATEGORY;
      const s = new Date(b.start), e = new Date(b.end);
      if (!(e > s)) return;
      cal.createEvent(`[${category}] ${clean(b.title)}`, s, e, { description: 'Added by Command Center' });
      addTask(clean(b.title), category, Math.round((e - s) / 6e4)); // blocks also go on the list so they can be checked off
      cache.put('ap:' + b.id, '1', 21600);
      made++;
    });
    tasks.filter(fresh).forEach(x => {
      addTask(clean(x.title), CATS.includes(x.category) ? x.category : CONFIG.DEFAULT_CATEGORY, Number(x.minutes) || 0);
      cache.put('ap:' + x.id, '1', 21600);
    });
    bust();
    return { ok: true, created: { blocks: made, tasks: added } };
  } finally {
    lock.releaseLock();
  }
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
const bust = () => CacheService.getScriptCache().remove('dash');

// ---------- sort: Claude turns the brain dump into tasks, then we find slots ----------
function sort({ text }) {
  text = String(text || '').trim();
  if (!text) throw new Error('Nothing to sort');
  if (text.length > 6000) throw new Error('That is a lot. Trim it under 6000 characters.');

  const tasks = askClaude(text).map(x => ({ ...x, id: Utilities.getUuid() }));
  const now = new Date();
  const from = roundUp(now, 5);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CONFIG.DAY_END_HOUR);
  const buf = CONFIG.BUFFER_MIN * 6e4;

  // Busy = today's remaining timed events, padded by the buffer on both sides.
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const busy = readEvents(dayStart, to)
    .filter(e => !e.allDay)
    .map(e => [new Date(e.start).getTime() - buf, new Date(e.end).getTime() + buf]);

  const blocks = [], quick = [], unscheduled = [];
  tasks.forEach(x => {
    if (x.minutes < CONFIG.BLOCK_MIN_MINUTES) return quick.push(x);
    const at = findSlot(busy, from.getTime(), to.getTime(), x.minutes * 6e4);
    if (at === null) return unscheduled.push(x);
    const end = at + x.minutes * 6e4;
    busy.push([at - buf, end + buf]);
    blocks.push({ ...x, start: new Date(at).toISOString(), end: new Date(end).toISOString() });
  });
  return { blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)), tasks: quick, unscheduled };
}

// Earliest start in [from, to] where `len` fits without touching a busy range.
function findSlot(busy, from, to, len) {
  let t = from;
  for (const [s, e] of busy.slice().sort((a, b) => a[0] - b[0])) {
    if (s - t >= len) return t;
    t = Math.max(t, e);
  }
  return to - t >= len ? t : null;
}

function roundUp(d, mins) {
  const ms = mins * 6e4;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function sortPrompt() {
  const tz = Session.getScriptTimeZone();
  const goals = readGoals().map(g => `- ${g.category}: ${g.goal} (${g.current} of ${g.target} ${g.unit})`).join('\n');
  return `You turn a spoken brain dump into a clean task list for Gi, a college student. The text was dictated with Wispr Flow, so expect filler words, run-on sentences and self-corrections. When Gi corrects something ("actually, make that Friday"), keep only the final version.

Rules:
- One task per distinct thing to do. Merge duplicates. Skip context, feelings and things that are already done.
- title: short and specific, starting with a verb, under 60 characters. Keep names, course codes and numbers exactly as said (ANTH 138A, 2 sponsors).
- category: exactly one of Academic, Career, Social, Personal. When a task could fit more than one, pick the goal it moves forward.
- minutes: a realistic estimate of focused time, in multiples of 5. Use a duration Gi states if there is one. Quick admin like a short email or an order is 5 to 15. Reading, writing and prep work is usually 30 to 90.
- Put the most time-sensitive tasks first.

Gi's current goals:
${goals || '- (none yet)'}

It is ${Utilities.formatDate(new Date(), tz, "EEEE, MMMM d, yyyy 'at' h:mm a")}.`;
}

function askClaude(text) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Script Properties');

  const schema = {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            category: { type: 'string', enum: CATS },
            minutes: { type: 'integer' },
          },
          required: ['title', 'category', 'minutes'],
          additionalProperties: false,
        },
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: 4000,
      system: sortPrompt(),
      messages: [{ role: 'user', content: text }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      fallbacks: 'default', // if a safety classifier declines, Anthropic retries on its recommended fallback model
    }),
  });

  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('Claude API: ' + (body.error?.message || res.getResponseCode()));
  if (body.stop_reason === 'refusal') throw new Error('Claude declined to sort that. Try rephrasing.');
  if (body.stop_reason === 'max_tokens') throw new Error('That was too long to sort in one go. Try splitting it.');
  const out = body.content.find(b => b.type === 'text');
  return JSON.parse(out.text).tasks
    .filter(x => x.title && CATS.includes(x.category))
    .map(x => ({ title: clean(x.title), category: x.category, minutes: Math.min(240, Math.max(5, Math.round(x.minutes / 5) * 5)) }));
}

// Run from the editor to see the exact prompt and a live result without touching the calendar.
function testSort() {
  Logger.log(sortPrompt());
  Logger.log(JSON.stringify(sort({ text: 'ok so I need to do my ANTH reading notes before Tuesday, reply to the two sponsors from yesterday, prep the TA slides, order bins for the lab' }), null, 2));
}
