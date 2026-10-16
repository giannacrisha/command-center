// Command Center: config, token, API calls, mock data and date helpers shared by index.html and phone.html.
const CC = (() => {
  // Paste your Apps Script web app URL (ends in /exec). Empty = demo mode with mock data.
  const API_URL = '';

  const CATS = ['Academic', 'Career', 'Social', 'Personal'];
  const params = new URLSearchParams(location.search);

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // Token: read ?token= once, keep it on this device, strip it from the address bar.
  let token = params.get('token');
  if (token) {
    store.set('cc-token', token);
    params.delete('token');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  } else {
    token = store.get('cc-token');
  }

  const mock = !API_URL || params.has('mock');

  // ?now=2026-10-15T08:42 freezes the clock (demos, screenshots). The clock still ticks from there.
  const nowParam = params.get('now');
  const offset = nowParam ? new Date(nowParam) - Date.now() : 0;
  const now = () => new Date(Date.now() + offset);

  async function get() {
    if (mock) return mockData();
    if (!token) throw new Error('No token on this device');
    const r = await fetch(`${API_URL}?action=dashboard&token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script cannot answer.
  async function post(action, body = {}) {
    if (mock) return mockPost(action, body);
    if (!token) throw new Error('No token on this device');
    const r = await fetch(`${API_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  // ---------- dates ----------
  const DAY = 864e5;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfWeek = d => addDays(startOfDay(d), -d.getDay());
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtT = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  const fmtTA = d => `${fmtT(d)} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  const hourLabel = h => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  const fmtDate = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const fmtDur = ms => {
    const m = Math.max(1, Math.round(ms / 6e4));
    return m < 60 ? `${m}M` : `${Math.floor(m / 60)}H${m % 60 ? ' ' + (m % 60) + 'M' : ''}`;
  };
  const ago = t => {
    const m = Math.round((Date.now() - t) / 6e4);
    return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Events with Date objects, sorted, for one calendar day.
  function eventsOn(data, day) {
    return data.events
      .map(e => ({ ...e, s: new Date(e.start), e: new Date(e.end) }))
      .filter(e => e.s < addDays(day, 1) && e.e > day)
      .sort((a, b) => a.s - b.s);
  }

  // Tasks for "today": everything open, plus anything due or finished today.
  function todaysTasks(data, day) {
    const today = isoDate(day);
    return data.tasks
      .filter(t => !t.done || t.due === today || t.doneOn === today)
      .sort((a, b) => a.done - b.done);
  }

  // ---------- mock data (shape matches Code.gs dashboard) ----------
  const WEEK = [
    [['Consulting', 14, 15, 'Social']],
    [['TA prof meeting', 10, 11, 'Career'], ['COSI 116A', 11, 12.33, 'Academic', 'Volen 101'], ['BDI shift', 13.5, 15.5, 'Career', 'Design Lab'], ['Push day', 18, 19.25, 'Personal', 'Gosman']],
    [['BUS 131A', 9, 9.83, 'Academic'], ['ANTH 138A', 10, 11.33, 'Academic', 'Olin-Sang 101'], ['TA presentation', 14, 15, 'Career'], ['Pull day', 18, 19.25, 'Personal', 'Gosman']],
    [['COSI 116A', 11, 12.33, 'Academic', 'Volen 101'], ['GWC meeting', 19, 20, 'Social']],
    [['BUS 131A', 9, 9.83, 'Academic'], ['ANTH 138A', 10, 11.33, 'Academic', 'Olin-Sang 101'], ['DeisHacks sync', 12, 13, 'Social'], ['BDI shift', 13.5, 15.5, 'Career', 'Design Lab'], ['TA office hours', 16, 17, 'Career'], ['Push day', 18, 19.25, 'Personal', 'Gosman']],
    [['Lab hours', 12, 14, 'Career'], ['DeisHacks recruiting', 16, 17, 'Social']],
    [['Leg day', 10, 11.5, 'Personal', 'Gosman']],
  ];

  function mockData() {
    const n = now(), wk = startOfWeek(n), events = [];
    const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(h), Math.round((h % 1) * 60));
    for (let i = 0; i < 8; i++) { // 8 days so Saturday night can show Sunday
      const d = addDays(wk, i);
      WEEK[i % 7].forEach(([title, s, e, category, location = ''], j) =>
        events.push({ id: `m${i}-${j}`, title, start: at(d, s).toISOString(), end: at(d, e).toISOString(), allDay: false, category, location }));
    }
    const today = isoDate(n);
    return {
      events,
      tasks: [
        { row: 2, task: 'ANTH 138A reading notes', category: 'Academic', done: false, due: today, minutes: 60 },
        { row: 3, task: 'Reply to 2 sponsors', category: 'Social', done: false, due: today, minutes: 10 },
        { row: 4, task: 'Prep Tuesday TA slides', category: 'Career', done: false, due: '', minutes: 40 },
        { row: 5, task: 'Order bins for the lab', category: 'Career', done: false, due: today, minutes: 5 },
        { row: 6, task: 'Log Workday hours', category: 'Career', done: true, doneOn: today, due: today, minutes: 5 },
      ],
      goals: [
        { row: 2, category: 'Academic', goal: 'Finish ANTH 138A paper draft', current: 2, target: 4, unit: 'readings' },
        { row: 3, category: 'Career', goal: 'Summer 2027 design eng internship', current: 6, target: 15, unit: 'apps' },
        { row: 4, category: 'Social', goal: 'Recruit DeisHacks organizers', current: 3, target: 7, unit: 'seats' },
        { row: 5, category: 'Personal', goal: 'Hold the cut', current: 4, target: 7, unit: 'protein days' },
      ],
      syncedAt: new Date().toISOString(),
    };
  }

  async function mockPost(action, body) {
    await new Promise(r => setTimeout(r, action === 'sort' ? 900 : 250));
    if (action !== 'sort') return { ok: true };
    const d = startOfDay(now());
    const at = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
    return {
      blocks: [
        { id: 'p1', title: 'Prep Tuesday TA slides', category: 'Career', minutes: 40, start: at(17, 10), end: at(17, 50) },
        { id: 'p2', title: 'ANTH 138A reading notes', category: 'Academic', minutes: 60, start: at(19, 25), end: at(20, 25) },
        { id: 'p3', title: 'Update DeisHacks sponsor deck', category: 'Social', minutes: 30, start: at(20, 35), end: at(21, 5) },
      ],
      tasks: [
        { id: 'q1', title: 'Reply to 2 sponsors', category: 'Social', minutes: 10 },
        { id: 'q2', title: 'Order bins for the lab', category: 'Career', minutes: 5 },
        { id: 'q3', title: 'Email prof about Tuesday', category: 'Academic', minutes: 15 },
        { id: 'q4', title: 'Book a haircut', category: 'Personal', minutes: 5 },
      ],
    };
  }

  return {
    CATS, mock, store, now, get, post, hasToken: () => !!token || mock,
    setToken(t) { token = t; store.set('cc-token', t); },
    startOfDay, addDays, startOfWeek, sameDay, isoDate, fmtT, fmtTA, hourLabel, fmtDate, fmtDur, ago, esc,
    eventsOn, todaysTasks,
  };
})();
