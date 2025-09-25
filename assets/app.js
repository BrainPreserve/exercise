/* BrainPreserve — Static App (CSV-strict)
   Rules:
   - Use /data/master.csv ONLY for type detection, goals, filtering, and rendering.
   - No invented tags. All filters derive from actual CSV columns/values.
   - Safety gates are deterministic and never overridden by AI.
*/

(() => {
  // ======= Utilities =======
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const state = {
    csvRows: [],
    csvHeaders: [],
    libraryView: [],
    admin: false,
    trendChart: null,
    metrics: loadMetrics(), // from localStorage
  };

  // Hard stop / caution thresholds (deterministic)
  // You may adjust thresholds clinically; these are conservative by design.
  const GATE = {
    HRV_DROP_WARN: -8,      // % drop versus 7-day baseline
    HRV_DROP_HOLD: -15,     // severe drop
    SLEEP_LOW_WARN: 85,     // %
    SLEEP_LOW_HOLD: 75,     // %
    SBP_HOLD: 170,          // mmHg (hold vigorous)
    DBP_HOLD: 100,          // mmHg
    TIR_WARN: 60,           // %
    TIR_HOLD: 40,           // %
    CRP_WARN: 3.0,          // mg/L
    CRP_HOLD: 10.0,         // mg/L
  };

  // Persisted metrics schema
  function loadMetrics() {
    try {
      const raw = localStorage.getItem('bp_metrics');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveMetrics(arr) {
    localStorage.setItem('bp_metrics', JSON.stringify(arr || []));
  }

  // ======= CSV loading =======
  async function loadCSV(urlOrFile) {
    return new Promise((resolve, reject) => {
      Papa.parse(urlOrFile, {
        header: true,
        download: !(urlOrFile instanceof File),
        dynamicTyping: false,
        skipEmptyLines: 'greedy',
        complete: (res) => resolve(res),
        error: (err) => reject(err)
      });
    });
  }

  // Normalize CSV row into deterministic object without inventing fields
  function normalizeRow(row) {
    // We reference only real CSV columns:
    // Required/used columns found in your file:
    // "Exercise Type", "exercise_key", "modality", "protocol_start",
    // "progression_rule", "contraindications_flags", "biomarker_hooks",
    // "cognitive_targets", "mechanism_tags", "safety_notes", "home_equipment",
    // "coach_script_non_api", "coach_prompt_api",
    // goal-related columns: "muscle_mass", "cv_fitness", "glycemic_control",
    // "blood_pressure", "body_composition", "lipids", "goal_label"
    const o = {
      title: (row['Exercise Type']||'').trim(),
      key: (row['exercise_key']||'').trim(),
      modality: (row['modality']||'').trim(),
      protocol_start: (row['protocol_start']||'').trim(),
      progression_rule: (row['progression_rule']||'').trim(),
      contraindications: (row['contraindications_flags']||'').trim(),
      biomarker_hooks: (row['biomarker_hooks']||'').trim(),
      cognitive_targets: (row['cognitive_targets']||'').trim(),
      mechanism_tags: (row['mechanism_tags']||'').trim(),
      safety_notes: (row['safety_notes']||'').trim(),
      equipment_raw: (row['home_equipment']||'').trim(),
      coach_non_api: (row['coach_script_non_api']||'').trim(),
      coach_prompt_api: (row['coach_prompt_api']||'').trim(),

      // Goal signals are derived only from the CSV columns listed below.
      muscle_mass: row['muscle_mass'],
      cv_fitness: row['cv_fitness'],
      glycemic_control: row['glycemic_control'],
      blood_pressure: row['blood_pressure'],
      body_composition: row['body_composition'],
      lipids: row['lipids'],
      goal_label: (row['goal_label']||'').trim(),
    };

    // Tokenize equipment safely
    o.equipment = o.equipment_raw
      ? o.equipment_raw.split(';').map(s => s.trim()).filter(Boolean)
      : [];

    // Derive boolean-ish goal flags strictly from actual values:
    // - We never invent goal names—only map presence/phrases from CSV columns.
    const toStr = v => (v==null ? '' : String(v)).trim().toLowerCase();

    o.goal_signals = {
      muscle: (toStr(o.muscle_mass) === '1') ||
              /increase|hypertroph|strength/.test(toStr(o.body_composition)),
      vo2: (o.cv_fitness && toStr(o.cv_fitness) && toStr(o.cv_fitness) !== 'unclear'),
      glycemic: /improv|insulin|glucose/.test(toStr(o.glycemic_control)),
      bp: /lower.*bp|hypertension/.test(toStr(o.blood_pressure)),
      weight: /reduce.*fat|adiposity|body comp/.test(toStr(o.body_composition)),
      // If your CSV later adds explicit "balance" or "sleep" columns, these will light up automatically.
      balance: /balance|fall/.test(toStr(o.cognitive_targets)) || /balance/.test(toStr(o.mechanism_tags)),
      sleep: /sleep|recovery|hrv/.test(toStr(o.mechanism_tags)) || /sleep/.test(toStr(o.cognitive_targets)),
    };

    return o;
  }

  // ======= Initialize =======
  async function init() {
    // Admin controls via ?admin=1 or Shift+D
    const url = new URL(location.href);
    state.admin = url.searchParams.get('admin') === '1';
    setAdminVisibility(state.admin);

    // Load CSV
    try {
      const parsed = await loadCSV('/data/master.csv');
      state.csvHeaders = parsed.meta.fields || [];
      state.csvRows = parsed.data.map(normalizeRow);

      // Populate Library filters from CSV values only
      buildTypeFilters();
      buildEquipmentFilters();

      // Inform user if Time filter is inert (no CSV column available)
      const timeNote = $('#timeNote');
      timeNote.textContent = 'No time column detected in CSV. Time filter is currently disabled. ' +
        'Add a numeric "time_minutes" column to /data/master.csv to enable deterministic time filtering.';

      // Render initial library
      renderLibrary(state.csvRows);

      // If admin, show CSV preview
      if (state.admin) refreshCsvPreview(state.csvRows, state.csvHeaders);
    } catch (e) {
      console.error('CSV load error:', e);
      alert('Could not load /data/master.csv. Ensure the file exists and is same-origin.');
    }

    // Hook UI
    wireTabs();
    wirePlan();
    wireLibrary();
    wireProgress();
    wireAsk();
    wireAdmin();
  }

  function setAdminVisibility(on) {
    $$('.admin-only').forEach(el => el.hidden = !on);
    $('#data').hidden = !on;
  }

  // ======= Tabs =======
  function wireTabs() {
    $$('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-tab');
        if (!t) return;
        $$('.tab').forEach(b => b.classList.toggle('active', b === btn));
        $$('.view').forEach(v => v.classList.toggle('active', v.id === t));
      });
    });
  }

  // ======= PLAN =======
  function wirePlan() {
    $('#saveMetrics').addEventListener('click', onSaveMetrics);
    $('#genPlan').addEventListener('click', onGeneratePlan);
    $('#clearForm').addEventListener('click', clearPlanForm);
  }

  function readPlanInputs() {
    const baseline = parseFloat($('#hrvBaseline').value);
    const today = parseFloat($('#hrvToday').value);
    const sleepEff = parseFloat($('#sleepEff').value);
    const sbp = parseFloat($('#sbp').value);
    const dbp = parseFloat($('#dbp').value);
    const tir = parseFloat($('#tir').value);
    const crp = parseFloat($('#crp').value);
    const focus = ($('input[name="planFocus"]:checked') || {}).value || 'both';
    const notes = $('#notes').value.trim();
    if ([baseline,today,sleepEff,sbp,dbp,tir,crp].some(v => Number.isNaN(v))) {
      throw new Error('Please complete all inputs.');
    }
    const hrvDelta = baseline > 0 ? ((today - baseline)/baseline)*100 : 0;
    return { baseline, today, sleepEff, sbp, dbp, tir, crp, focus, notes, hrvDelta };
  }

  function classifyGates(m) {
    const badges = [];

    // HRV gates
    if (m.hrvDelta <= GATE.HRV_DROP_HOLD) {
      badges.push({cls:'bad', text:`HRV Δ ${m.hrvDelta.toFixed(1)}% (hold high-intensity)`});
    } else if (m.hrvDelta <= GATE.HRV_DROP_WARN) {
      badges.push({cls:'warn', text:`HRV Δ ${m.hrvDelta.toFixed(1)}% (caution)`});
    } else {
      badges.push({cls:'ok', text:`HRV Δ ${m.hrvDelta.toFixed(1)}%`});
    }

    // Sleep
    if (m.sleepEff < GATE.SLEEP_LOW_HOLD) {
      badges.push({cls:'bad', text:`Sleep ${m.sleepEff.toFixed(0)}% (hold vigorous)`});
    } else if (m.sleepEff < GATE.SLEEP_LOW_WARN) {
      badges.push({cls:'warn', text:`Sleep ${m.sleepEff.toFixed(0)}% (caution)`});
    } else {
      badges.push({cls:'ok', text:`Sleep ${m.sleepEff.toFixed(0)}%`});
    }

    // BP
    if (m.sbp >= GATE.SBP_HOLD || m.dbp >= GATE.DBP_HOLD) {
      badges.push({cls:'bad', text:`BP ${m.sbp}/${m.dbp} (hold vigorous)`});
    } else {
      badges.push({cls:'ok', text:`BP ${m.sbp}/${m.dbp}`});
    }

    // TIR
    if (m.tir < GATE.TIR_HOLD) {
      badges.push({cls:'bad', text:`TIR ${m.tir.toFixed(0)}% (avoid HIIT)`});
    } else if (m.tir < GATE.TIR_WARN) {
      badges.push({cls:'warn', text:`TIR ${m.tir.toFixed(0)}% (moderate only)`});
    } else {
      badges.push({cls:'ok', text:`TIR ${m.tir.toFixed(0)}%`});
    }

    // CRP
    if (m.crp >= GATE.CRP_HOLD) {
      badges.push({cls:'bad', text:`hs-CRP ${m.crp.toFixed(1)} mg/L (hold vigorous)`});
    } else if (m.crp >= GATE.CRP_WARN) {
      badges.push({cls:'warn', text:`hs-CRP ${m.crp.toFixed(1)} mg/L (caution)`});
    } else {
      badges.push({cls:'ok', text:`hs-CRP ${m.crp.toFixed(1)} mg/L`});
    }

    // High-intensity allowed?
    const hiAllowed = !badges.some(b => b.cls === 'bad');
    return { badges, hiAllowed };
  }

  function baselineText(m, gates) {
    const lines = [];
    lines.push(`Focus: ${m.focus === 'both' ? 'Muscle + Aerobic' : (m.focus==='muscle'?'Muscle':'Aerobic')}`);
    if (!gates.hiAllowed) {
      lines.push('Today avoid high-intensity intervals, max-effort lifts, and breathless efforts.');
    } else {
      lines.push('High-intensity is acceptable if technique is safe and you feel well.');
    }
    lines.push('Warm-up 5–8 min; cool-down 5–8 min.');
    return lines.join('\n');
  }

  function recommendFromCSV(m, gates) {
    // Filter by focus and safety (no override by AI)
    let rows = state.csvRows.slice();

    // Remove rows with explicit contraindications if BP high/CRP very high, etc., using actual CSV text flags only.
    // We DO NOT invent flags; we search CSV "contraindications_flags" text safely.
    const contraindicationTextMatch = (txt) => {
      const t = (txt||'').toLowerCase();
      if (!t) return false;
      if (!gates.hiAllowed && /hiit|sprint|max|all-out/.test(t)) return true;
      // If BP is high, avoid protocols flagged with "uncontrolled hypertension" in CSV text.
      if ((m.sbp >= GATE.SBP_HOLD || m.dbp >= GATE.DBP_HOLD) && /hypertension|high bp|bp caution/.test(t)) return true;
      return false;
    };
    rows = rows.filter(r => !contraindicationTextMatch(r.contraindications));

    // Focus ranking based on CSV goal signals only
    const preferMuscle = m.focus === 'muscle';
    const preferAerobic = m.focus === 'aerobic';

    rows = rows.map(r => {
      let score = 0;
      if (preferMuscle && r.goal_signals.muscle) score += 2;
      if (preferAerobic && (r.goal_signals.vo2 || r.modality === 'aerobic')) score += 2;
      if (m.tir < GATE.TIR_WARN && r.goal_signals.glycemic) score += 1;
      if (m.sbp >= 130 && r.goal_signals.bp) score += 1;
      if (m.crp >= GATE.CRP_WARN && r.goal_signals.sleep) score += 0.5; // recovery-tilted
      return {...r, _score: score};
    });

    // Sort by score then stable by title
    rows.sort((a,b) => b._score - a._score || a.title.localeCompare(b.title));

    // Top 5 recommendations
    return rows.slice(0, 5);
  }

  function renderPlan(recos, m, gates) {
    // Summary
    $('#plan-summary').textContent = baselineText(m, gates);

    // Badges
    const g = $('#plan-gates');
    g.innerHTML = '';
    gates.badges.forEach(b => {
      const el = document.createElement('span');
      el.className = `badge ${b.cls}`;
      el.textContent = b.text;
      g.appendChild(el);
    });

    // Rec cards
    const list = $('#plan-recos');
    list.innerHTML = '';
    recos.forEach(r => {
      const card = document.createElement('div');
      card.className = 'rec-card';
      const meta = [
        r.modality ? `Type: ${r.modality}` : '',
        r.goal_label ? `Targets: ${r.goal_label}` : '',
        r.safety_notes ? `Safety: ${r.safety_notes}` : ''
      ].filter(Boolean).join(' · ');
      card.innerHTML = `
        <div class="title">${r.title}</div>
        <div class="meta small">${meta}</div>
        <div class="small">${r.protocol_start ? ('<strong>Start:</strong> ' + r.protocol_start) : ''}</div>
        <div class="small">${r.progression_rule ? ('<strong>Progression:</strong> ' + r.progression_rule) : ''}</div>
        ${r.coach_non_api ? `<div class="coach"><h4>Coach (deterministic)</h4>${escapeHtml(r.coach_non_api)}</div>` : ''}
      `;
      list.appendChild(card);
    });
  }

  async function onGeneratePlan() {
    try {
      const m = readPlanInputs();
      const gates = classifyGates(m);
      const recos = recommendFromCSV(m, gates);
      renderPlan(recos, m, gates);
    } catch (e) {
      alert(e.message || 'Please check inputs.');
    }
  }

  function onSaveMetrics() {
    try {
      const m = readPlanInputs();
      const date = new Date();
      state.metrics.push({
        dateISO: date.toISOString(),
        hrvBaseline: m.baseline,
        hrvToday: m.today,
        hrvDeltaPct: +m.hrvDelta.toFixed(2),
        sleepEff: +m.sleepEff.toFixed(1),
        sbp: m.sbp, dbp: m.dbp,
        tir: +m.tir.toFixed(1),
        crp: +m.crp.toFixed(2),
        focus: m.focus,
        notes: m.notes
      });
      saveMetrics(state.metrics);
      updateProgress();
      // Immediate visual feedback
      onGeneratePlan();
    } catch (e) {
      alert(e.message || 'Please check inputs.');
    }
  }

  function clearPlanForm() {
    $('#metrics-form').reset();
  }

  // ======= LIBRARY =======
  function wireLibrary() {
    $('#applyFinder').addEventListener('click', applyFinder);
    $('#clearFinder').addEventListener('click', () => {
      $$('#goalFilters input[type=checkbox]').forEach(i=> i.checked=false);
      $$('input[name="timeAvail"]').forEach(i=> i.checked = (i.value === '30'));
      $$('input[name="libFocus"]').forEach(i=> i.checked = (i.value === 'both'));
      $$('#libTypeFilters input[type=checkbox]').forEach(i=> i.checked=false);
      $$('#equipFilters input[type=checkbox]').forEach(i=> i.checked=false);
      renderLibrary(state.csvRows);
    });
  }

  function buildTypeFilters() {
    const container = $('#libTypeFilters');
    container.innerHTML = '';
    const set = new Set(state.csvRows.map(r => r.modality).filter(Boolean));
    Array.from(set).sort().forEach(mod => {
      const id = `mod_${mod}`;
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" id="${id}" value="${mod}"/> ${mod}`;
      container.appendChild(label);
    });
  }

  function buildEquipmentFilters() {
    const allEquip = new Set();
    state.csvRows.forEach(r => r.equipment.forEach(e => allEquip.add(e)));
    const container = $('#equipFilters');
    container.innerHTML = '';
    Array.from(allEquip).sort().forEach(eq => {
      const id = `eq_${eq.replace(/\W+/g,'_')}`;
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" id="${id}" value="${eq}"/> ${eq}`;
      container.appendChild(label);
    });
  }

  function applyFinder() {
    const goals = $$('#goalFilters input[type=checkbox]:checked').map(i=>i.value);
    const focus = ($('input[name="libFocus"]:checked')||{}).value || 'both';
    const types = $$('#libTypeFilters input[type=checkbox]:checked').map(i=>i.value);
    const equip = $$('#equipFilters input[type=checkbox]:checked').map(i=>i.value);

    let rows = state.csvRows.slice();

    // Filter by goal signals using only CSV-derived booleans/text
    if (goals.length) {
      rows = rows.filter(r => goals.some(g => !!r.goal_signals[g]));
    }

    // Filter by modality types (CSV: "modality")
    if (types.length) {
      rows = rows.filter(r => r.modality && types.includes(r.modality));
    }

    // Filter by equipment (CSV: "home_equipment" tokens)
    if (equip.length) {
      rows = rows.filter(r => {
        if (!r.equipment.length) return false;
        return equip.every(e => r.equipment.includes(e));
      });
    }

    // Time filter is disabled unless a numeric "time_minutes" column exists.
    const hasTime = state.csvHeaders.includes('time_minutes');
    if (hasTime) {
      const selectedTime = ($('input[name="timeAvail"]:checked')||{}).value;
      if (selectedTime) {
        const mins = parseInt(selectedTime, 10);
        rows = rows.filter(r => {
          const t = Number(r['time_minutes']);
          return Number.isFinite(t) ? (mins <= 20 ? t <= 20 : t >= 20) : true;
        });
      }
    }

    // Focus nudges scoring (CSV-only signals)
    rows = rows.map(r => {
      let score = 0;
      if (focus === 'muscle' && r.goal_signals.muscle) score += 2;
      if (focus === 'aerobic' && (r.goal_signals.vo2 || r.modality === 'aerobic')) score += 2;
      if (goals.includes('glycemic') && r.goal_signals.glycemic) score += 1;
      if (goals.includes('bp') && r.goal_signals.bp) score += 1;
      return {...r, _score: score};
    }).sort((a,b)=> b._score - a._score || a.title.localeCompare(b.title));

    renderLibrary(rows);
  }

  function renderLibrary(rows) {
    state.libraryView = rows;
    const target = $('#library-list');
    target.innerHTML = '';
    rows.forEach(r => {
      const wrap = document.createElement('div');
      wrap.className = 'rec-card';
      const goalsList = Object.entries(r.goal_signals)
        .filter(([,v]) => v)
        .map(([k]) => k)
        .join(', ');
      const equipment = r.equipment.join(', ');
      wrap.innerHTML = `
        <div class="title">${r.title}</div>
        <div class="meta small">
          ${r.modality ? `Type: ${r.modality} · ` : ''} 
          ${r.goal_label ? `Targets: ${r.goal_label} · ` : ''} 
          ${equipment ? `Equipment: ${equipment}` : ''}
        </div>
        ${r.protocol_start ? `<div class="small"><strong>Start:</strong> ${r.protocol_start}</div>`:''}
        ${r.progression_rule ? `<div class="small"><strong>Progression:</strong> ${r.progression_rule}</div>`:''}
        ${goalsList ? `<div class="small"><strong>Detected goals (from CSV):</strong> ${goalsList}</div>`:''}
        ${r.coach_non_api ? `<div class="coach"><h4>Coach (deterministic)</h4>${escapeHtml(r.coach_non_api)}</div>`:''}
      `;
      target.appendChild(wrap);
    });
  }

  // ======= PROGRESS =======
  function wireProgress() {
    updateProgress();
    $('#exportMetrics').addEventListener('click', exportMetrics);
    $('#clearMetrics').addEventListener('click', () => {
      if (confirm('Clear all saved metrics?')) {
        state.metrics = [];
        saveMetrics(state.metrics);
        updateProgress();
      }
    });
  }

  function updateProgress() {
    // Latest BP/CRP
    const latest = state.metrics[state.metrics.length - 1];
    $('#latest-bp').textContent = latest ? `${latest.sbp}/${latest.dbp}` : '—';
    $('#latest-crp').textContent = latest ? `${latest.crp} mg/L` : '—';

    // Table
    const wrap = $('#saved-table');
    wrap.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.innerHTML = `
      <thead>
        <tr>
          <th>Date</th><th>HRV Δ%</th><th>Sleep %</th><th>TIR %</th>
          <th>SBP/DBP</th><th>hs-CRP</th><th>Focus</th><th>Notes</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    (state.metrics||[]).forEach(r => {
      const tr = document.createElement('tr');
      const d = new Date(r.dateISO);
      tr.innerHTML = `
        <td>${d.toLocaleDateString()}</td>
        <td>${r.hrvDeltaPct}</td>
        <td>${r.sleepEff}</td>
        <td>${r.tir}</td>
        <td>${r.sbp}/${r.dbp}</td>
        <td>${r.crp}</td>
        <td>${r.focus}</td>
        <td>${escapeHtml(r.notes||'')}</td>`;
      tbl.querySelector('tbody').appendChild(tr);
    });
    wrap.appendChild(tbl);

    // Chart (HRV Δ%, Sleep %, TIR %)
    const ctx = $('#trendChart');
    if (state.trendChart) {
      state.trendChart.destroy();
      state.trendChart = null;
    }
    const labels = (state.metrics||[]).map(r => new Date(r.dateISO).toLocaleDateString());
    const hrv = (state.metrics||[]).map(r => r.hrvDeltaPct);
    const sleep = (state.metrics||[]).map(r => r.sleepEff);
    const tir = (state.metrics||[]).map(r => r.tir);

    state.trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'HRV Δ% (vs baseline)', data: hrv },
          { label: 'Sleep %', data: sleep },
          { label: 'TIR %', data: tir }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  function exportMetrics() {
    const rows = [
      ['date','hrv_baseline','hrv_today','hrv_delta_pct','sleep_eff','sbp','dbp','tir','crp','focus','notes'],
      ...(state.metrics||[]).map(r => [
        r.dateISO, r.hrvBaseline, r.hrvToday, r.hrvDeltaPct, r.sleepEff, r.sbp, r.dbp, r.tir, r.crp, r.focus, r.notes
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:'metrics.csv'});
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ======= ASK =======
  function wireAsk() {
    $('#askBtn').addEventListener('click', onAsk);
  }

  async function onAsk() {
    const q = $('#askInput').value.trim();
    if (!q) return;
    const latest = state.metrics[state.metrics.length - 1];
    let det = 'Deterministic response requires at least one saved day (Save Today). ';
    let gatesInfo = null;
    if (latest) {
      const gates = classifyGates({
        hrvDelta: latest.hrvDeltaPct,
        sleepEff: latest.sleepEff,
        sbp: latest.sbp, dbp: latest.dbp,
        tir: latest.tir, crp: latest.crp
      });
      gatesInfo = gates;
      det = buildDeterministicAnswer(q, latest, gates);
    }
    let answer = det;

    // Attempt AI addendum via /api/coach (never overrides gates)
    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ question: q, latest, gates: gatesInfo })
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.addendum) {
          answer += `\n\n———\nAI addendum:\n${json.addendum}`;
        }
      }
    } catch (e) {
      // silent fail is acceptable
    }

    $('#askAnswer').textContent = answer;
  }

  function buildDeterministicAnswer(q, latest, gates) {
    const lines = [];
    const hi = gates.hiAllowed;
    lines.push(`Based on your latest metrics: HRV Δ ${latest.hrvDeltaPct}%; Sleep ${latest.sleepEff}%; BP ${latest.sbp}/${latest.dbp}; TIR ${latest.tir}%; hs-CRP ${latest.crp} mg/L.`);

    if (!hi) {
      lines.push('Recommendation: avoid high-intensity intervals and max-effort work today; favor moderate, technique-focused training.');
    } else {
      lines.push('Recommendation: high-intensity efforts are acceptable if technique is safe and you feel well; progress conservatively.');
    }

    // Simple rules driven by CSV goal relevance cannot “invent” protocols; we only add phrasing.
    if (/hiit|sprint/i.test(q) && !hi) {
      lines.push('Given current gates, HIIT/sprints are not advised today.');
    }
    if (/resistance|weights|lift/i.test(q) && latest.sbp >= GATE.SBP_HOLD) {
      lines.push('Avoid max-effort sets due to elevated BP; use submaximal loads and longer rest.');
    }
    lines.push('Warm-up 5–8 min and end with a cool-down. Stop for red-flag symptoms.');

    return lines.join('\n');
  }

  // ======= DATA (Admin) =======
  function wireAdmin() {
    // Shift+D toggles admin
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        state.admin = !state.admin;
        const url = new URL(location.href);
        url.searchParams.set('admin', state.admin ? '1' : '0');
        history.replaceState({}, '', url.toString());
        setAdminVisibility(state.admin);
        if (state.admin) refreshCsvPreview(state.csvRows, state.csvHeaders);
      }
    });

    $('#reloadCsv')?.addEventListener('click', async () => {
      const parsed = await loadCSV('/data/master.csv');
      state.csvHeaders = parsed.meta.fields || [];
      state.csvRows = parsed.data.map(normalizeRow);
      if (state.admin) refreshCsvPreview(state.csvRows, state.csvHeaders);
      buildTypeFilters();
      buildEquipmentFilters();
      renderLibrary(state.csvRows);
    });

    $('#fileCsv')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const parsed = await loadCSV(file);
      state.csvHeaders = parsed.meta.fields || [];
      state.csvRows = parsed.data.map(normalizeRow);
      refreshCsvPreview(state.csvRows, state.csvHeaders);
      buildTypeFilters();
      buildEquipmentFilters();
      renderLibrary(state.csvRows);
    });

    $('#disableAdmin')?.addEventListener('click', (e) => {
      e.preventDefault();
      state.admin = false;
      const url = new URL(location.href);
      url.searchParams.set('admin','0');
      location.href = url.toString();
    });
  }

  function refreshCsvPreview(rows, headers) {
    const wrap = $('#csvPreview');
    wrap.innerHTML = '';
    const tbl = document.createElement('table');
    const thead = document.createElement('thead');
    const hdrRow = document.createElement('tr');
    (headers||[]).forEach(h => {
      const th = document.createElement('th'); th.textContent = h; hdrRow.appendChild(th);
    });
    thead.appendChild(hdrRow);
    tbl.appendChild(thead);
    const tb = document.createElement('tbody');
    rows.slice(0, 25).forEach(r => {
      const tr = document.createElement('tr');
      (headers||[]).forEach(h => {
        const td = document.createElement('td');
        td.textContent = (r[h] != null ? r[h] : (r[h] === 0 ? 0 : (r[h] || ''))); // best effort
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
  }

  // ======= Helpers =======
  function escapeHtml(s) {
    return String(s||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Boot
  init();
})();
