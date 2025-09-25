/* BrainPreserve — Exercise Coach
 * CSV-first deterministic logic + automatic AI addendum
 * Multiple saves per day are allowed (timestamped entries).
 */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const on = (el, ev, fn) => el.addEventListener(ev, fn);

/* ---------- string & CSV helpers ---------- */
const splitMulti = (raw) => {
  if (!raw || typeof raw !== 'string') return [];
  const parts = (raw.includes(';') ? raw.split(';') : raw.split(','))
    .map(s => s.trim())
    .filter(Boolean);
  return parts;
};

const htmlEscape = (s='') =>
  s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);

/* ---------- column detection ---------- */
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,'_');

const detectColumnSet = (rows) => {
  const cols = Object.keys(rows[0] || {});
  const normMap = {};
  for (const c of cols) normMap[normalize(c)] = c;

  const pick = (...aliases) => {
    for (const a of aliases) {
      const n = normalize(a);
      if (normMap[n]) return normMap[n];
    }
    return undefined;
  };

  return {
    title:        pick('title','name','protocol'),
    summary:      pick('summary','desc','description','details'),
    goals:        pick('goals','goal','indications'),
    exercise_type:pick('exercise_type','exercise type','type','modality'),
    equipment:    pick('equipment','home_equipment'),
    time_min:     pick('time_minutes','duration_minutes'),
    coach_non_api:pick('coach_script_non_api','non_api_coach','coach_text'),
    safety:       pick('safety','contraindications','notes'),
    intensity:    pick('intensity','rpe','zone'),
    tags:         pick('tags','labels'),
    key:          pick('exercise_key','key','id')
  };
};

const col = (row, key) => (key && key in row ? row[key] : undefined);

/* ---------- state ---------- */
const State = {
  rows: [],
  cols: {},
  filters: { goals: new Set(), types: new Set(), equip: new Set(), time: null },
  chart: null,
  admin: false
};

/* ---------- tabs ---------- */
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

const applyAdminVisibility = () => {
  const q = new URLSearchParams(location.search);
  State.admin = q.get('admin') === '1' || location.hash.toLowerCase() === '#admin';
  const dataTabBtn = $(`.tab[data-tab="data"]`);
  const dataSection = $('#data');
  if (State.admin) {
    dataTabBtn?.removeAttribute('hidden');
    dataSection?.removeAttribute('hidden');
  } else {
    dataTabBtn?.setAttribute('hidden','');
    dataSection?.setAttribute('hidden','');
  }
};

/* ---------- CSV load ---------- */
const loadCSV = () => new Promise((resolve, reject) => {
  Papa.parse('data/master.csv', {
    header: true, skipEmptyLines: true, download: true,
    complete: ({ data, errors }) => {
      if (errors && errors.length) console.warn('CSV parse warnings:', errors.slice(0,3));
      const rows = data.filter(r => Object.values(r).some(v => v && String(v).trim() !== ''));
      State.rows = rows;
      State.cols = detectColumnSet(rows);
      const diag = { detected_columns: State.cols, total_rows: rows.length, sample_row: rows[0]||null };
      $('#csvDiag').textContent = JSON.stringify(diag, null, 2);
      renderCSVPreview(); // admin-only table
      resolve();
    },
    error: (err) => reject(err)
  });
});

/* ---------- Data tab: preview ---------- */
const renderCSVPreview = () => {
  if (!State.admin) return;
  const tbl = $('#csvTable');
  if (!tbl) return;
  tbl.innerHTML = '';
  const rows = State.rows.slice(0,50);
  if (!rows.length) return;

  const cols = Object.keys(rows[0]);
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${cols.map(c=>`<th>${htmlEscape(c)}</th>`).join('')}</tr>`;
  tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => `<td>${htmlEscape(String(r[c] ?? ''))}</td>`).join('');
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
};

/* ---------- Library filters & render ---------- */
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
    const lab = document.createElement('label');
    lab.className = 'chip';
    lab.innerHTML = `<input type="checkbox" id="${id}" value="${htmlEscape(v)}"> ${htmlEscape(v)}`;
    container.appendChild(lab);
    on(lab.querySelector('input'), 'change', (e) => {
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
    $('#timeNotice').textContent = 'No time column detected in CSV. Time filter disabled. Add a numeric "time_minutes" column to enable deterministic time filtering.';
    wrap.closest('details').open = true;
  } else {
    $('#timeNotice').textContent = '';
  }
};

const clearLibraryFilters = () => {
  State.filters.goals.clear();
  State.filters.types.clear();
  State.filters.equip.clear();
  State.filters.time = null;
  // Uncheck all checkboxes & radios
  $$('#goalChips input, #typeChips input, #equipChips input').forEach(i => i.checked = false);
  $$('input[name="timeOpt"]').forEach(r => r.checked = false);
  renderLibrary();
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
    return '';
  }
};

const buildPromptFromRow = (r) => {
  const c = State.cols;
  const title = col(r,c.title) || col(r,c.exercise_type) || col(r,c.key) || 'Protocol';
  const summary = col(r,c.summary) || '';
  const goals = c.goals ? splitMulti(r[c.goals]).join(', ') : '';
  const type  = c.exercise_type ? splitMulti(r[c.exercise_type]).join(', ') : '';
  const equip = c.equipment ? splitMulti(r[c.equipment]).join(', ') : '';
  const safety = col(r,c.safety) || '';
  const intensity = col(r,c.intensity) || '';
  return `You are an exercise coach for older adults focused on cognitive health. Provide a concise coaching paragraph that adds value beyond the deterministic CSV fields.
Protocol: ${title}
Summary: ${summary}
Goals: ${goals}
Type: ${type}
Equipment: ${equip}
Intensity: ${intensity}
Safety notes: ${safety}
Tone: clinical, supportive, concise. Avoid repeating the CSV fields verbatim.`;
};

const renderLibrary = async () => {
  const list = $('#libraryList');
  list.innerHTML = '';
  const c = State.cols;
  const rows = State.rows.filter(libraryFilter);

  for (const r of rows) {
    const title = col(r,c.title) || col(r,c.exercise_type) || col(r,c.key) || 'Protocol';
    const summary = col(r,c.summary) || '';
    const goals = c.goals ? splitMulti(r[c.goals]) : [];
    const type  = c.exercise_type ? splitMulti(r[c.exercise_type]) : [];
    const equip = c.equipment ? splitMulti(r[c.equipment]) : [];
    const timeM = c.time_min ? Number(r[c.time_min] || 0) : null;
    const nonAPI = col(r,c.coach_non_api) || '';

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${htmlEscape(title)}</h3>
      ${summary ? `<p class="prose">${htmlEscape(summary)}</p>` : ''}
      <div class="protocol-meta">
        ${goals.map(g=>`<span class="badge">${htmlEscape(g)}</span>`).join('')}
        ${type.map(t=>`<span class="badge">${htmlEscape(t)}</span>`).join('')}
        ${timeM?`<span class="badge">${timeM} min</span>`:''}
      </div>
      ${equip.length?`<p class="notice"><strong>Equipment:</strong> ${equip.map(htmlEscape).join(', ')}</p>`:''}
      ${nonAPI?`<div class="prose"><strong>Coach Summary (deterministic):</strong> ${htmlEscape(nonAPI)}</div>`:''}
      <div class="ai-block" hidden>
        <h4>AI Coaching Insights</h4>
        <div class="prose"></div>
      </div>
    `;
    list.appendChild(card);

    // Auto AI addendum
    const aiWrap = card.querySelector('.ai-block');
    const aiBody = aiWrap.querySelector('.prose');
    const prompt = buildPromptFromRow(r);
    const text = await callCoachAPI(prompt);
    if (text && text.trim()) {
      aiBody.textContent = text.trim();
      aiWrap.hidden = false;
    }
  }
};

/* ---------- Plan: deterministic + save ---------- */
const computePlanDeterministic = (m) => {
  const hrvDelta = ((m.hrvToday - m.hrvBaseline) / m.hrvBaseline) * 100;
  const riskyBP = (m.sbp >= 160) || (m.dbp >= 100);
  const poorSleep = m.sleepEff < 80;
  const lowTIR = m.tir < 70;
  const highCRP = m.crp >= 3;

  let focus = m.focus;
  if (riskyBP || highCRP) focus = 'aerobic';
  if (poorSleep && focus === 'muscle') focus = 'both';

  const msg = [
    `HRV Δ: ${hrvDelta.toFixed(1)}%`,
    `Sleep eff: ${m.sleepEff}%`,
    `BP: ${m.sbp}/${m.dbp} mmHg`,
    `TIR: ${m.tir}%`,
    `hs-CRP: ${m.crp} mg/L`,
    riskyBP ? '— Caution: elevated BP → lower-intensity aerobic & longer warm-up.' : '',
    highCRP ? '— Inflammation elevated → keep intensity moderate.' : '',
    lowTIR ? '— Metabolic off → avoid high-glycolytic repeats.' : ''
  ].filter(Boolean).join('<br>');

  const steer = {
    muscle: 'Technique-first resistance (2–3 sets, RPE 6–7), finish with mobility.',
    aerobic: 'Zone 2–3 continuous or intervals (20–30 min), nasal-breathing pace.',
    both: '15–20 min Z2, then 2 compound sets (RPE 6–7), finish with balance.'
  }[focus];

  return {
    html: `<p>${msg}</p><p><strong>Plan focus:</strong> ${focus}. ${steer}</p>`,
    prompt: `Create a one-paragraph, safe session for an older adult focused on brain health.
HRV baseline ${m.hrvBaseline} ms, today ${m.hrvToday} ms; Sleep ${m.sleepEff}%; BP ${m.sbp}/${m.dbp}; TIR ${m.tir}%; hs-CRP ${m.crp} mg/L.
Desired focus: ${m.focus}. Apply safety gating as appropriate.`
  };
};

const wirePlan = () => {
  const f = $('#metricsForm');

  on(f, 'submit', async (e) => {
    e.preventDefault();
    const m = {
      hrvBaseline: Number($('#hrvBaseline').value),
      hrvToday: Number($('#hrvToday').value),
      sleepEff: Number($('#sleepEff').value),
      sbp: Number($('#sbp').value),
      dbp: Number($('#dbp').value),
      tir: Number($('#tir').value),
      crp: Number($('#crp').value),
      focus: ($$('input[name="focus"]:checked')[0]||{}).value || 'muscle'
    };
    const det = computePlanDeterministic(m);
    $('#planDeterministic').innerHTML = det.html;

    const aiText = await callCoachAPI(det.prompt);
    if (aiText && aiText.trim()) {
      $('#planAIText').textContent = aiText.trim();
      $('#planAI').hidden = false;
    } else {
      $('#planAI').hidden = true;
    }
  });

  on($('#clearMetrics'), 'click', () => {
    f.reset();
    $('#planDeterministic').innerHTML = '';
    $('#planAI').hidden = true;
    $('#saveMsg').hidden = true;
  });

  on($('#saveMetrics'), 'click', () => {
    // Each save has a precise timestamp; multiple entries per day allowed
    const now = new Date();
    const entry = {
      id: now.getTime(), // unique
      date: now.toISOString().slice(0,10),
      time: now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
      hrvBaseline: Number($('#hrvBaseline').value || 0),
      hrvToday: Number($('#hrvToday').value || 0),
      sleepEff: Number($('#sleepEff').value || 0),
      sbp: Number($('#sbp').value || 0),
      dbp: Number($('#dbp').value || 0),
      tir: Number($('#tir').value || 0),
      crp: Number($('#crp').value || 0)
    };
    const arr = JSON.parse(localStorage.getItem('bp_days') || '[]');
    arr.push(entry);
    localStorage.setItem('bp_days', JSON.stringify(arr));
    renderDays();
    renderChart();
    const msg = $('#saveMsg'); msg.hidden = false;
  });
};

/* ---------- Progress (table + chart) ---------- */
const renderDays = () => {
  const arr = JSON.parse(localStorage.getItem('bp_days') || '[]');
  const tbl = $('#daysTable');
  tbl.innerHTML = '<tr><th>Date</th><th>Time</th><th>HRV base</th><th>HRV today</th><th>Δ%</th><th>Sleep%</th><th>BP</th><th>TIR%</th><th>CRP</th></tr>';
  for (const d of arr) {
    const delta = d.hrvBaseline ? ((d.hrvToday - d.hrvBaseline) / d.hrvBaseline) * 100 : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.date}</td><td>${d.time||''}</td><td>${d.hrvBaseline}</td><td>${d.hrvToday}</td><td>${isFinite(delta)?delta.toFixed(1):'—'}</td><td>${d.sleepEff}</td><td>${d.sbp}/${d.dbp}</td><td>${d.tir}</td><td>${d.crp}</td>`;
    tbl.appendChild(tr);
  }
};

const renderChart = () => {
  const arr = JSON.parse(localStorage.getItem('bp_days') || '[]');
  const labels = arr.map(d => `${d.date} ${d.time||''}`.trim());
  const data = arr.map(d => d.hrvBaseline ? ((d.hrvToday - d.hrvBaseline) / d.hrvBaseline) * 100 : 0);
  const ctx = $('#progressChart');
  if (State.chart) State.chart.destroy();
  State.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'HRV Δ% (today vs baseline)', data }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
};

/* ---------- Ask (independent of Plan) ---------- */
const deterministicAnswer = (q) => {
  const text = q.toLowerCase();
  const c = State.cols;
  const picks = [];
  for (const r of State.rows) {
    const fields = [
      col(r, c.title), col(r, c.summary),
      ...(c.goals? splitMulti(r[c.goals]):[]),
      ...(c.exercise_type? splitMulti(r[c.exercise_type]):[]),
      ...(c.tags? splitMulti(r[c.tags]):[])
    ].filter(Boolean).join(' ').toLowerCase();
    if (fields.includes(text)) picks.push(r);
    if (picks.length >= 5) break;
  }
  if (!picks.length) return 'No deterministic match in the CSV for that query.';
  return 'Potential protocols: ' + picks.map(r => (col(r,c.title) || col(r,c.exercise_type) || col(r,c.key) || 'Protocol')).join(' · ');
};

const wireAsk = () => {
  on($('#askBtn'), 'click', async () => {
    const q = ($('#askInput').value || '').trim();
    if (!q) return;
    $('#askOutDet').innerHTML = `<p>${htmlEscape(deterministicAnswer(q))}</p>`;
    const ai = await callCoachAPI(`Question: ${q}\nAdd a concise coaching paragraph for an older adult focused on brain health. Avoid repeating any deterministic list I provided.`);
    if (ai && ai.trim()) {
      $('#askOutAIText').textContent = ai.trim();
      $('#askOutAI').hidden = false;
    } else {
      $('#askOutAI').hidden = true;
    }
  });
};

/* ---------- Boot ---------- */
(async function boot(){
  try {
    applyAdminVisibility();
    wireTabs();
    await loadCSV();

    // Filters
    if (State.cols.goals) renderChips($('#goalChips'), uniqueFrom('goals'), 'goals');
    if (State.cols.exercise_type) renderChips($('#typeChips'), uniqueFrom('exercise_type'), 'types');
    if (State.cols.equipment) renderChips($('#equipChips'), uniqueFrom('equipment'), 'equip');
    renderTimeRadios();
    on($('#clearLibrary'), 'click', clearLibraryFilters);

    // Main views
    await renderLibrary();
    wirePlan();
    renderDays();
    renderChart();
    wireAsk();
  } catch (e) {
    console.error('Boot failure:', e);
    wireTabs(); // keep UI usable even if load fails
  }
})();
