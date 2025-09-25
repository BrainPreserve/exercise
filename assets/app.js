/* BrainPreserve — Exercise Coach
 * CSV-first deterministic logic + automatic AI addendum
 * No guessing: only uses detected CSV columns; sections hide if absent.
 */

/* ------- Utilities ------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const on = (el, ev, fn) => el.addEventListener(ev, fn);

const splitMulti = (raw) => {
  if (!raw || typeof raw !== 'string') return [];
  // Prefer semicolons; fall back to commas
  const hasSemi = raw.includes(';');
  const parts = (hasSemi ? raw.split(';') : raw.split(','))
    .map(s => s.trim())
    .filter(Boolean);
  return parts;
};

const col = (row, names) => {
  for (const n of names) if (n in row && row[n] !== undefined) return row[n];
  return undefined;
};

const detectColumnSet = (rows) => {
  const cols = Object.keys(rows[0] || {});
  const has = (name) => cols.includes(name);

  const map = {
    title: cols.find(c => /^(title|name|protocol)$/i.test(c)),
    summary: cols.find(c => /^(summary|desc|description|details)$/i.test(c)),
    goals: cols.find(c => /^(goals?|indications?)$/i.test(c)),
    exercise_type: cols.find(c => /^(exercise_?type|type|modality)$/i.test(c)),
    equipment: cols.find(c => /^(equipment|home_?equipment)$/i.test(c)),
    time_min: cols.find(c => /^(time_minutes?|duration_minutes?)$/i.test(c)),
    coach_non_api: cols.find(c => /^(coach_script_non_api|non_api_coach|coach_text)$/i.test(c)),
    safety: cols.find(c => /^(safety|contraindications|notes)$/i.test(c)),
    intensity: cols.find(c => /^(intensity|rpe|zone)$/i.test(c)),
    tags: cols.find(c => /^(tags|labels)$/i.test(c)),
  };
  return map;
};

const htmlEscape = (s='') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ------- App State ------- */
const State = {
  rows: [],
  cols: {},
  filters: { goals: new Set(), types: new Set(), equip: new Set(), time: null },
  chart: null
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
    complete: ({ data, errors, meta }) => {
      if (errors && errors.length) console.warn('CSV parse warnings:', errors.slice(0,3));
      // Clean empty rows
      const rows = data.filter(r => Object.values(r).some(v => v && String(v).trim() !== ''));
      State.rows = rows;
      State.cols = detectColumnSet(rows);
      const diag = {
        detected_columns: State.cols,
        sample_row: rows[0] || null,
        total_rows: rows.length
      };
      $('#csvDiag').textContent = JSON.stringify(diag, null, 2);
      resolve();
    },
    error: (err) => reject(err)
  });
});

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
    $('#timeNotice').textContent = 'No time column detected in CSV. Time filter disabled. Add a numeric "time_minutes" column to enable deterministic time filtering.';
    wrap.closest('details').open = true;
  } else {
    $('#timeNotice').textContent = '';
  }
};

const libraryFilter = (row) => {
  const c = State.cols;
  // Goals
  if (State.filters.goals.size && c.goals) {
    const g = new Set(splitMulti(row[c.goals]));
    if (![...State.filters.goals].some(x => g.has(x))) return false;
  }
  // Types
  if (State.filters.types.size && c.exercise_type) {
    const t = new Set(splitMulti(row[c.exercise_type]));
    if (![...State.filters.types].some(x => t.has(x))) return false;
  }
  // Equipment
  if (State.filters.equip.size && c.equipment) {
    const e = new Set(splitMulti(row[c.equipment]));
    if (![...State.filters.equip].some(x => e.has(x))) return false;
  }
  // Time
  if (State.filters.time && c.time_min) {
    const tm = Number(row[c.time_min] || 0);
    if (isFinite(tm)) {
      if (State.filters.time === 10 && tm > 10) return false;
      if (State.filters.time === 20 && (tm <= 10 || tm > 20)) return false;
      // 30+ => pass
    }
  }
  return true;
};

const buildPromptFromRow = (row) => {
  const c = State.cols;
  const title = col(row, [c.title]) || 'Unnamed protocol';
  const summary = col(row, [c.summary]) || '';
  const goals = c.goals ? splitMulti(row[c.goals]).join(', ') : '';
  const type  = c.exercise_type ? splitMulti(row[c.exercise_type]).join(', ') : '';
  const equip = c.equipment ? splitMulti(row[c.equipment]).join(', ') : '';
  const safety = col(row, [c.safety]) || '';
  const intensity = col(row, [c.intensity]) || '';
  return `You are an exercise coach for older adults focused on cognitive health. Provide a brief, practical coaching paragraph (no bullets) that adds value beyond the deterministic CSV details.
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
  } catch (e) {
    console.warn('AI addendum unavailable:', e.message);
    return ''; // graceful fallback
  }
};

const renderLibrary = async () => {
  const list = $('#libraryList');
  list.innerHTML = '';
  const c = State.cols;
  const rows = State.rows.filter(libraryFilter);

  for (const r of rows) {
    const title = col(r, [c.title]) || 'Unnamed protocol';
    const summary = col(r, [c.summary]) || '';
    const goals = c.goals ? splitMulti(r[c.goals]) : [];
    const type  = c.exercise_type ? splitMulti(r[c.exercise_type]) : [];
    const equip = c.equipment ? splitMulti(r[c.equipment]) : [];
    const timeM = c.time_min ? Number(r[c.time_min] || 0) : null;
    const nonAPI = col(r, [c.coach_non_api]) || '';

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${htmlEscape(title)}</h3>
      <p class="prose">${htmlEscape(summary)}</p>
      <div class="protocol-meta">
        ${goals.map(g=>`<span class="badge">${htmlEscape(g)}</span>`).join('')}
        ${type.map(t=>`<span class="badge">${htmlEscape(t)}</span>`).join('')}
        ${timeM?`<span class="badge">${timeM} min</span>`:''}
      </div>
      ${equip.length?`<p class="help"><strong>Equipment:</strong> ${equip.map(htmlEscape).join(', ')}</p>`:''}
      ${nonAPI?`<div class="prose"><strong>Coach Summary (deterministic):</strong> ${htmlEscape(nonAPI)}</div>`:''}
      <div class="ai-block" data-ai="pending" hidden>
        <h4>AI Coaching Insights</h4>
        <div class="prose"></div>
      </div>
    `;
    list.appendChild(card);

    // Automatic AI addendum (no toggles)
    const prompt = buildPromptFromRow(r);
    const aiWrap = card.querySelector('.ai-block');
    const aiBody = aiWrap.querySelector('.prose');
    const text = await callCoachAPI(prompt);
    if (text && text.trim()) {
      aiBody.textContent = text.trim();
      aiWrap.hidden = false;
    }
  }
};

/* ------- Plan tab ------- */
const computePlanDeterministic = (m) => {
  // Simple safety gates and steering, CSV-agnostic
  const hrvDelta = ((m.hrvToday - m.hrvBaseline) / m.hrvBaseline) * 100;
  const riskyBP = (m.sbp >= 160) || (m.dbp >= 100);
  const poorSleep = m.sleepEff < 80;
  const lowTIR = m.tir < 70;
  const highCRP = m.crp >= 3;

  let focus = m.focus; // 'muscle'|'aerobic'|'both'
  if (riskyBP || highCRP) focus = 'aerobic';
  if (poorSleep) focus = (focus === 'muscle' ? 'both' : focus);

  const msg = [
    `HRV Δ: ${hrvDelta.toFixed(1)}%`,
    `Sleep eff: ${m.sleepEff}%`,
    `BP: ${m.sbp}/${m.dbp} mmHg`,
    `TIR: ${m.tir}%`,
    `hs-CRP: ${m.crp} mg/L`,
    riskyBP ? '— Caution: elevated BP, emphasize lower-intensity aerobic and technique.' : '',
    highCRP ? '— Inflammation elevated; keep intensity moderate, extend warm-up.' : '',
    lowTIR ? '— Metabolic signal is off; avoid high-glycolytic repeats today.' : ''
  ].filter(Boolean).join('<br>');

  const steer = {
    muscle: 'Technique-first resistance (2–3 sets, RPE 6–7), finish with mobility.',
    aerobic: 'Zone 2–3 continuous or intervals (20–30 min), nose-breathing pacing.',
    both: '15–20 min Z2, then 2 compound sets (RPE 6–7), finish with balance.'
  }[focus];

  return {
    html: `<p>${msg}</p><p><strong>Plan focus:</strong> ${focus}. ${steer}</p>`,
    prompt: `Create a one-paragraph, safe plan for an older adult focused on brain health.
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
  });

  on($('#saveMetrics'), 'click', () => {
    const day = {
      date: new Date().toISOString().slice(0,10),
      hrvBaseline: Number($('#hrvBaseline').value),
      hrvToday: Number($('#hrvToday').value),
      sleepEff: Number($('#sleepEff').value),
      sbp: Number($('#sbp').value),
      dbp: Number($('#dbp').value),
      tir: Number($('#tir').value),
      crp: Number($('#crp').value)
    };
    const arr = JSON.parse(localStorage.getItem('bp_days') || '[]');
    arr.push(day);
    localStorage.setItem('bp_days', JSON.stringify(arr));
    renderDays();
    renderChart();
  });
};

/* ------- Progress ------- */
const renderDays = () => {
  const arr = JSON.parse(localStorage.getItem('bp_days') || '[]');
  const tbl = $('#daysTable');
  tbl.innerHTML = '<tr><th>Date</th><th>HRV base</th><th>HRV today</th><th>Δ%</th><th>Sleep%</th><th>BP</th><th>TIR%</th><th>CRP</th></tr>';
  for (const d of arr) {
    const delta = ((d.hrvToday - d.hrvBaseline) / d.hrvBaseline) * 100;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.date}</td><td>${d.hrvBaseline}</td><td>${d.hrvToday}</td><td>${delta.toFixed(1)}</td><td>${d.sleepEff}</td><td>${d.sbp}/${d.dbp}</td><td>${d.tir}</td><td>${d.crp}</td>`;
    tbl.appendChild(tr);
  }
};

const renderChart = () => {
  const arr = JSON.parse(localStorage.getItem('bp_days') || '[]');
  const labels = arr.map(d => d.date);
  const data = arr.map(d => ((d.hrvToday - d.hrvBaseline) / d.hrvBaseline) * 100);
  const ctx = $('#progressChart');
  if (State.chart) State.chart.destroy();
  State.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'HRV Δ% (today vs baseline)', data }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
};

/* ------- Ask ------- */
const deterministicAnswer = (q) => {
  const text = q.toLowerCase();
  // Very lightweight CSV-based matcher
  const c = State.cols;
  const picks = [];
  for (const r of State.rows) {
    const fields = [
      col(r, [c.title]), col(r, [c.summary]),
      ...(c.goals? splitMulti(r[c.goals]):[]),
      ...(c.exercise_type? splitMulti(r[c.exercise_type]):[]),
      ...(c.tags? splitMulti(r[c.tags]):[])
    ].filter(Boolean).join(' ').toLowerCase();
    if (fields.includes(text)) picks.push(r);
    if (picks.length >= 5) break;
  }
  if (!picks.length) return 'No direct deterministic match in the CSV for that query. Try a more specific goal or modality text that exists in your data.';
  return 'Potential protocols: ' + picks.map(r => col(r,[State.cols.title]) || 'Unnamed').join(' · ');
};

const wireAsk = () => {
  on($('#askBtn'), 'click', async () => {
    const q = ($('#askInput').value || '').trim();
    if (!q) return;
    // Deterministic from CSV
    const det = deterministicAnswer(q);
    $('#askOutDet').innerHTML = `<p>${htmlEscape(det)}</p>`;
    // AI addendum (no dependency on Plan)
    const ai = await callCoachAPI(`Question: ${q}\nUse the dataset context only for inspiration; add a concise coaching paragraph for an older adult focused on brain health. Avoid repeating any deterministic list I provided.`);
    if (ai && ai.trim()) {
      $('#askOutAIText').textContent = ai.trim();
      $('#askOutAI').hidden = false;
    } else {
      $('#askOutAI').hidden = true;
    }
  });
};

/* ------- Boot ------- */
(async function boot(){
  try {
    wireTabs();
    await loadCSV();

    // Filters
    if (State.cols.goals) renderChips($('#goalChips'), uniqueFrom('goals'), 'goals');
    if (State.cols.exercise_type) renderChips($('#typeChips'), uniqueFrom('exercise_type'), 'types');
    if (State.cols.equipment) renderChips($('#equipChips'), uniqueFrom('equipment'), 'equip');
    renderTimeRadios();

    await renderLibrary();
    wirePlan();
    renderDays();
    renderChart();
    wireAsk();
  } catch (e) {
    console.error('Boot failure:', e);
    // Keep tabs usable even if something failed
    wireTabs();
  }
})();
