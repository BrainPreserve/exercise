/* BrainPreserve — Exercise Coach
 * CSV-first deterministic logic + automatic AI addendum
 * Sessions persistence: multiple saves per day with timestamps.
 */

/* ------- Utilities ------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const on = (el, ev, fn) => el.addEventListener(ev, fn);

const splitMulti = (raw) => {
  if (!raw || typeof raw !== 'string') return [];
  const hasSemi = raw.includes(';');
  return (hasSemi ? raw.split(';') : raw.split(',')).map(s => s.trim()).filter(Boolean);
};

const htmlEscape = (s='') =>
  s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);

const fmtTime = (iso) => {
  try {
    const d = new Date(iso);
    const pad = (n)=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
};

const col = (row, names) => {
  for (const n of names) if (n && n in row && row[n] !== undefined) return row[n];
  return undefined;
};

const detectColumnSet = (rows) => {
  const cols = Object.keys(rows[0] || {});
  const pick = (re) => cols.find(c => re.test(c));
  return {
    title:          pick(/^(title|name|protocol|Exercise Type|exercise[_ ]?type)$/i),
    summary:        pick(/^(summary|desc|description|details)$/i),
    goals:          pick(/^(goals?|indications?)$/i),
    exercise_type:  pick(/^(exercise[_ ]?type|type|modality|Exercise Type)$/i),
    equipment:      pick(/^(equipment|home[_ ]?equipment)$/i),
    time_min:       pick(/^(time[_ ]?minutes?|duration[_ ]?minutes?)$/i),
    coach_non_api:  pick(/^(coach_script_non_api|non_api_coach|coach_text)$/i),
    safety:         pick(/^(safety|contraindications|notes)$/i),
    intensity:      pick(/^(intensity|rpe|zone)$/i),
    tags:           pick(/^(tags|labels)$/i),
    key:            pick(/^(exercise_key|key|id)$/i),
  };
};

/* ------- App State ------- */
const State = {
  rows: [],
  cols: {},
  filters: { goals: new Set(), types: new Set(), equip: new Set(), time: null },
  chart: null,
  lastSaveClickTs: 0,
  isAdmin: false
};

/* ------- Tabs ------- */
const wireTabs = () => {
  $$('.tab').forEach(btn => {
    on(btn, 'click', () => {
      $$('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $$('.view').forEach(v => v.classList.remove('active'));
      $('#' + tab).classList.add('active');
    });
  });
};

/* ------- CSV Load ------- */
const loadCSV = () => new Promise((resolve, reject) => {
  Papa.parse('data/master.csv', {
    header: true, skipEmptyLines: true, download: true,
    complete: ({ data, errors }) => {
      if (errors && errors.length) console.warn('CSV parse warnings:', errors.slice(0,3));
      const rows = data.filter(r => Object.values(r).some(v => v && String(v).trim() !== ''));
      State.rows = rows;
      State.cols = detectColumnSet(rows);
      resolve();
    },
    error: (err) => reject(err)
  });
});

/* ------- Admin visibility for Data tab ------- */
const setAdminVisibility = () => {
  const isAdmin = /\badmin=1\b/.test(location.search) || location.hash === '#admin';
  State.isAdmin = isAdmin;
  const dataTabBtn = $(`.tab[data-tab="data"]`);
  const dataView = $('#data');
  if (isAdmin) {
    dataTabBtn.hidden = false;
    dataTabBtn.classList.remove('admin-only');
    dataView.hidden = false;
    // Fill diagnostics later after CSV load
  } else {
    dataTabBtn.hidden = true;
    dataView.hidden = true;
  }
};

/* ------- Library: filters + render ------- */
const uniqueFrom = (key) => {
  const name = State.cols[key];
  if (!name) return [];
  const sets = new Set();
  for (const r of State.rows) splitMulti(r[name]).forEach(v => sets.add(v));
  return Array.from(sets).sort((a,b)=>a.localeCompare(b));
};

const renderChips = (container, items, group) => {
  container.innerHTML = '';
  items.forEach(v => {
    const id = `chip-${group}-${v.replace(/\s+/g,'_')}`;
    const div = document.createElement('label');
    div.className = 'chip';
    div.innerHTML = `<input type="checkbox" id="${id}" value="${htmlEscape(v)}"> ${htmlEscape(v)}`;
    container.appendChild(div);
    on(div.querySelector('input'), 'change', (e) => {
      const set = State.filters[group];
      if (e.target.checked) set.add(v); else set.delete(v);
      renderLibrary();
    });
  });
};

const renderTimeRadios = () => {
  const wrap = $('#timeRadios');
  wrap.innerHTML = `
    <label><input type="radio" name="timeOpt" value="10"> 10 min</label>
    <label><input type="radio" name="timeOpt" value="20"> 20 min</label>
    <label><input type="radio" name="timeOpt" value="30"> 30+ min</label>
  `;
  $$('input[name="timeOpt"]').forEach(r =>
    on(r, 'change', () => { State.filters.time = Number(r.value); renderLibrary(); })
  );
  if (!State.cols.time_min) {
    $('#timeNotice').textContent = 'No time column detected in CSV. Time filter disabled. Add numeric "time_minutes" to enable it.';
  } else {
    $('#timeNotice').textContent = '';
  }
};

const libraryFilter = (row) => {
  const c = State.cols;
  if (State.filters.goals.size && c.goals) {
    const g = new Set(splitMulti(row[c.goals]));
    if (![...State.filters.goals].some(x => g.has(x))) return false;
  }
  if (State.filters.types.size && c.exercise_type) {
    const t = new Set(splitMulti(row[c.exercise_type]));
    if (![...State.filters.types].some(x => t.has(x))) return false;
  }
  if (State.filters.equip.size && c.equipment) {
    const e = new Set(splitMulti(row[c.equipment]));
    if (![...State.filters.equip].some(x => e.has(x))) return false;
  }
  if (State.filters.time && c.time_min) {
    const tm = Number(row[c.time_min] || 0);
    if (isFinite(tm)) {
      if (State.filters.time === 10 && tm > 10) return false;
      if (State.filters.time === 20 && (tm <= 10 || tm > 20)) return false;
    }
  }
  return true;
};

const buildPromptFromRow = (row) => {
  const c = State.cols;
  const title = col(row, [c.title, c.key]) || 'Protocol';
  const summary = col(row, [c.summary]) || '';
  const goals = c.goals ? splitMulti(row[c.goals]).join(', ') : '';
  const type  = c.exercise_type ? splitMulti(row[c.exercise_type]).join(', ') : '';
  const equip = c.equipment ? splitMulti(row[c.equipment]).join(', ') : '';
  const safety = col(row, [c.safety]) || '';
  const intensity = col(row, [c.intensity]) || '';
  return `You are an exercise coach for older adults focused on cognitive health. Provide a brief, practical coaching paragraph that adds value beyond deterministic CSV details.
Protocol: ${title}
Summary: ${summary}
Goals: ${goals}
Type: ${type}
Equipment: ${equip}
Intensity: ${intensity}
Safety notes: ${safety}
Tone: clinical, supportive, concise. Avoid repeating the deterministic fields verbatim.`;
};

const callCoachAPI = async (prompt) => {
  try {
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.text || data.answer || data.output || '';
  } catch {
    return ''; // graceful fallback
  }
};

const renderLibrary = async () => {
  const list = $('#libraryList');
  list.innerHTML = '';
  const c = State.cols;
  const rows = State.rows.filter(libraryFilter);

  for (const r of rows) {
    const title = col(r, [c.title, c.key]) || 'Unnamed protocol';
    const summary = col(r, [c.summary]) || '';
    const goals = c.goals ? splitMulti(r[c.goals]) : [];
    const type  = c.exercise_type ? splitMulti(r[c.exercise_type]) : [];
    const equip = c.equipment ? splitMulti(r[c.equipment]) : [];
    const timeM = c.time_min ? Number(r[c.time_min] || 0) : null;
    const nonAPI = col(r, [c.coach_non_api]) ||
