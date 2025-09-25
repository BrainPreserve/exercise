/* Brain Health Exercise App — deterministic MVP
   - Loads /data/master.csv with PapaParse
   - Safety/adaptation gates: HRV Δ%, sleep %, SBP/DBP, CGM TIR, hs-CRP
   - muscle_mass=1 filter when selected
   - Saves daily snapshots in localStorage, renders Chart.js line chart
   - Shows coach_script_non_api when available
   - Deterministic “Ask the Coach” routing
*/

(function(){
  const els = {
    tabs: document.querySelectorAll('.tab'),
    views: document.querySelectorAll('.view'),
    // Plan
    hrvBaseline: document.getElementById('hrvBaseline'),
    hrvToday: document.getElementById('hrvToday'),
    sleepEff: document.getElementById('sleepEff'),
    sbp: document.getElementById('sbp'),
    dbp: document.getElementById('dbp'),
    tir: document.getElementById('tir'),
    crp: document.getElementById('crp'),
    notes: document.getElementById('notes'),
    muscleFocus: document.getElementById('muscleFocus'),
    saveMetrics: document.getElementById('saveMetrics'),
    genPlan: document.getElementById('genPlan'),
    planSummary: document.getElementById('plan-summary'),
    planGates: document.getElementById('plan-gates'),
    planRecos: document.getElementById('plan-recos'),
    // Library
    libSearch: document.getElementById('libSearch'),
    libMuscleOnly: document.getElementById('libMuscleOnly'),
    libraryList: document.getElementById('library-list'),
    // Progress
    trendChartEl: document.getElementById('trendChart'),
    savedTable: document.getElementById('saved-table'),
    latestBP: document.getElementById('latest-bp'),
    latestCRP: document.getElementById('latest-crp'),
    exportBtn: document.getElementById('exportMetrics'),
    clearBtn: document.getElementById('clearMetrics'),
    // Data
    reloadCsv: document.getElementById('reloadCsv'),
    fileCsv: document.getElementById('fileCsv'),
    csvPreview: document.getElementById('csvPreview')
  };

  const state = {
    rows: [],             // parsed CSV rows
    metrics: [],          // [{date, hrvBaseline, hrvToday, hrvDeltaPct, sleepEff, sbp, dbp, tir, crp, notes}]
    chart: null
  };

  // ---- Tabs
  els.tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      els.tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      els.views.forEach(v=>v.classList.toggle('active', v.id===tab));
      if (tab==='progress') drawChart();
    });
  });

  // ---- Storage helpers
  const STORAGE_KEY = 'bhe_metrics_v1';
  function loadMetrics(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.metrics = raw ? JSON.parse(raw) : [];
    } catch { state.metrics = []; }
  }
  function saveMetrics(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.metrics));
  }

  // ---- CSV load
  async function loadCsvFromPath(path='data/master.csv'){
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      const text = await res.text();
      const parsed = Papa.parse(text, { header:true, dynamicTyping:true, skipEmptyLines:true });
      // Normalize headers to snake_case copies as needed
      state.rows = parsed.data.map(r => normalizeRow(r));
      renderLibrary();
      previewCsv(state.rows);
    } catch (e){
      state.rows = [];
      previewCsv([]);
      console.warn('CSV load error:', e);
    }
  }

  // Normalize/defensive access
  function normalizeRow(r){
    // Make some friendly aliases
    const out = { ...r };
    // Normalize muscle_mass to "1" or 1 truthy
    out.muscle_mass = ('' + (r.muscle_mass ?? r.MUSCLE_MASS ?? '')).trim();
    // Lowercase modality-ish string for scoring
    out._mod = (r.modality || r.Modality || r['Exercise Type'] || r.exercise_key || '').toString().toLowerCase();
    // Coach text
    out._coach = (r.coach_script_non_api || r.COACH_SCRIPT_NON_API || '').toString().trim();
    // Contra flags
    out._contra = (r.contraindications_flags || r.CONTRAINDICATIONS_FLAGS || '').toString().toLowerCase();
    // Targets (optional)
    out._targets = (r.cognitive_targets || r.COGNITIVE_TARGETS || '').toString();
    return out;
  }

  // ---- Library render
  function renderLibrary(){
    const q = els.libSearch.value?.toLowerCase().trim() || '';
    const mOnly = els.libMuscleOnly.checked;
    const list = document.createElement('div');

    const data = state.rows.filter(row=>{
      if (mOnly && !(row.muscle_mass==='1' || row.muscle_mass===1)) return false;
      if (!q) return true;
      const blob = JSON.stringify(row).toLowerCase();
      return blob.includes(q);
    });

    if (data.length===0){
      els.libraryList.innerHTML = `<p class="small">No matching protocols. Check your CSV or search terms.</p>`;
      return;
    }
    data.forEach(row=>{
      const title = row['Exercise Type'] || row.exercise_type || row.exercise_key || 'Protocol';
      const mod = row.modality || '';
      const targets = row._targets;
      const mm = (row.muscle_mass==='1'||row.muscle_mass===1) ? 'muscle_mass=1' : '';
      const coach = row._coach;

      const card = document.createElement('div');
      card.className = 'rec-card';
      card.innerHTML = `
        <div class="title">${escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(mod)} ${mm ? ' • '+mm : ''}</div>
        ${targets ? `<div class="small">${escapeHtml(targets)}</div>` : ``}
        ${coach ? `<div class="coach"><strong>Coach Note:</strong> ${escapeHtml(coach)}</div>` : ``}
      `;
      list.appendChild(card);
    });
    els.libraryList.replaceChildren(list);
  }

  // ---- Plan generation (deterministic)
  function computePlanFromLatest(){
    if (!state.rows.length) return { summary:'No CSV rows loaded.', gates:[], recos:[] };

    const m = readFormMetrics(); // uses the current form (whether saved or not)
    if (!m) return { summary:'Please complete Today’s Inputs first.', gates:[], recos:[] };

    const gates = [];
    const recs = [];

    const hrvDelta = m.hrvDeltaPct;              // %
    const hrvLow = (isFinite(hrvDelta) && hrvDelta <= -7);       // ≤ −7%
    const sleepLow = (m.sleepEff < 85);
    const bpHigh = (m.sbp >= 160 || m.dbp >= 100);
    const tirLow = (m.tir < 70);
    const crpHigh = (m.crp > 3);

    if (bpHigh)   gates.push({tag:'Hypertension (SBP≥160 or DBP≥100): avoid HIIT/plyo', level:'bad'});
    if (hrvLow)   gates.push({tag:'HRV low (≤ −7% vs baseline): deload', level:'warn'});
    if (sleepLow) gates.push({tag:'Sleep efficiency <85%: deload', level:'warn'});
    if (tirLow)   gates.push({tag:'CGM TIR <70%: prioritize resistance + Zone 2', level:'warn'});
    if (crpHigh)  gates.push({tag:'hs-CRP >3 mg/L: prefer low-impact + isometrics', level:'warn'});

    // Score library rows
    const muscleFocus = (els.muscleFocus.value === 'on');
    const scored = [];
    for (const row of state.rows){
      if (muscleFocus && !(row.muscle_mass==='1' || row.muscle_mass===1)) continue;

      const mod = (row._mod || '');
      const title = row['Exercise Type'] || row.exercise_type || row.exercise_key || 'Protocol';

      const isRes  = /resist|strength|weights|rt|lift/.test(mod);
      const isZ2   = /zone ?2|aerobic|endurance|walk|cycle|bike|z2/.test(mod);
      const isMob  = /mobility|stretch|flex/.test(mod);
      const isIso  = /isometric|isometrics|iso/.test(mod);
      const isHIIT = /hiit|interval/.test(mod);
      const isPlyo = /plyo/.test(mod);
      const isBreath = /breath|breathing|mindful|coherent/.test(mod);

      let score = 1; // base
      // Gates → scoring preferences
      if (bpHigh){ // no HIIT/plyo
        if (isHIIT || isPlyo) score -= 50;
        if (isMob || isBreath || isZ2) score += 4;
        if (isIso) score += 3;
      }
      if (hrvLow || sleepLow){
        if (isZ2) score += 4;
        if (isMob) score += 3;
        if (isHIIT || isPlyo) score -= 6;
        if (isRes) score -= 1; // conservative deloading bias
      }
      if (tirLow){
        if (isRes) score += 5;
        if (isZ2) score += 3;
      }
      if (crpHigh){
        if (isIso || isZ2) score += 3;
        if (isPlyo || isHIIT) score -= 3;
      }
      // If row lists contraindications and they include hiit/plyo, bias down
      if (row._contra.includes('hiit') || row._contra.includes('plyo')) score -= 2;

      scored.push({ row, title, score });
    }

    scored.sort((a,b)=>b.score - a.score);
    const top = scored.slice(0, 5);

    // Build summary text
    const summary = [
      `HRV Δ%: ${fmtPct(hrvDelta)}  |  Sleep: ${m.sleepEff}%  |  BP: ${m.sbp}/${m.dbp}  |  TIR: ${m.tir}%  |  hs-CRP: ${m.crp} mg/L`,
      bpHigh   ? `• High BP gate active → avoid HIIT/plyometrics; choose mobility, isometrics, easy Zone 2.` : ``,
      (hrvLow || sleepLow) ? `• Recovery gate active → deload intensity; emphasize Zone 2 + mobility.` : ``,
      tirLow   ? `• Glycemic control focus → prioritize resistance first, then Zone 2; add post-meal walks.` : ``,
      crpHigh  ? `• Inflammation high → lower impact; favor isometrics/low-impact aerobic.` : ``,
    ].filter(Boolean).join('\n');

    // Recommendations display objects
    top.forEach(t=>{
      const r = t.row;
      const coach = r._coach ? r._coach : defaultCoachText(r, {bpHigh, hrvLow, sleepLow, tirLow, crpHigh});
      recs.push({
        title: t.title,
        modality: r.modality || '',
        meta: [ (r.muscle_mass==='1'||r.muscle_mass===1) ? 'muscle_mass=1' : '', r.cognitive_targets || ''].filter(Boolean).join(' • '),
        coach
      });
    });

    return { summary, gates, recos: recs };
  }

  function defaultCoachText(row, flags){
    const bits = [];
    if (flags.bpHigh)  bits.push('Avoid HIIT/plyometrics today; choose lower-impact work.');
    if (flags.hrvLow || flags.sleepLow) bits.push('Deload intensity/volume; keep RPE ≤ 6/10.');
    if (flags.tirLow)  bits.push('Resistance first (glycemic benefit), then easy Zone 2.');
    if (flags.crpHigh) bits.push('Favor isometrics/low-impact aerobic; limit impact until CRP improves.');
    return (row.coach_script_non_api ? String(row.coach_script_non_api) + ' ' : '') + bits.join(' ');
  }

  // ---- Renderers
  function renderPlan(){
    const { summary, gates, recos } = computePlanFromLatest();
    els.planSummary.textContent = summary || '';
    // badges
    const frag = document.createDocumentFragment();
    if (gates.length===0){
      const b = badge('No active safety gates', 'ok');
      frag.appendChild(b);
    } else {
      gates.forEach(g=>{
        const b = badge(g.tag, g.level);
        frag.appendChild(b);
      });
    }
    els.planGates.replaceChildren(frag);

    // recos
    const wrap = document.createElement('div');
    recos.forEach(r=>{
      const div = document.createElement('div');
      div.className = 'rec-card';
      div.innerHTML = `
        <div class="title">${escapeHtml(r.title)}</div>
        <div class="meta">${escapeHtml(r.modality || '')}${r.meta ? ' • '+escapeHtml(r.meta) : ''}</div>
        <div class="coach">${escapeHtml(r.coach)}</div>
      `;
      wrap.appendChild(div);
    });
    els.planRecos.replaceChildren(wrap);
  }

  function badge(text, level){
    const span = document.createElement('span');
    span.className = `badge ${level||''}`;
    span.textContent = text;
    return span;
  }

  function previewCsv(rows){
    if (!rows || !rows.length){
      els.csvPreview.innerHTML = `<p class="small">No data loaded. Ensure <code>/data/master.csv</code> exists in your repository.</p>`;
      return;
    }
    const headers = Object.keys(rows[0]);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.slice(0,10).forEach(h=>{
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.slice(0,20).forEach(r=>{
      const tr = document.createElement('tr');
      headers.slice(0,10).forEach(h=>{
        const td = document.createElement('td');
        td.textContent = (r[h] ?? '').toString();
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    els.csvPreview.replaceChildren(table);
  }

  // ---- Progress
  function drawChart(){
    const labels = state.metrics.map(m=>m.date);
    const hrv = state.metrics.map(m=>m.hrvDeltaPct);
    const sleep = state.metrics.map(m=>m.sleepEff);
    const tir = state.metrics.map(m=>m.tir);

    if (state.chart){
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = hrv;
      state.chart.data.datasets[1].data = sleep;
      state.chart.data.datasets[2].data = tir;
      state.chart.update();
    } else {
      const ctx = els.trendChartEl.getContext('2d');
      state.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'HRV Δ% (vs 7-day)', data: hrv },
            { label: 'Sleep Efficiency (%)', data: sleep },
            { label: 'CGM TIR (%)', data: tir }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
    }

    // latest vitals (bp, crp)
    if (state.metrics.length){
      const last = state.metrics[state.metrics.length-1];
      els.latestBP.textContent = `${last.sbp}/${last.dbp} mmHg`;
      els.latestCRP.textContent = `${last.crp} mg/L`;
    } else {
      els.latestBP.textContent = '—';
      els.latestCRP.textContent = '—';
    }

    // table
    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Date</th><th>HRV Δ%</th><th>Sleep %</th><th>SBP/DBP</th><th>TIR %</th><th>CRP</th><th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${state.metrics.map(m=>`
          <tr>
            <td>${m.date}</td>
            <td>${fmtPct(m.hrvDeltaPct)}</td>
            <td>${m.sleepEff}</td>
            <td>${m.sbp}/${m.dbp}</td>
            <td>${m.tir}</td>
            <td>${m.crp}</td>
            <td>${escapeHtml(m.notes||'')}</td>
          </tr>`).join('')}
      </tbody>`;
    els.savedTable.replaceChildren(table);
  }

  // ---- Ask (deterministic)
  function deterministicAnswer(q){
    const L = q.toLowerCase();
    const last = state.metrics[state.metrics.length-1] || readFormMetrics() || {};
    const bpHigh = (toNum(last.sbp) >= 160 || toNum(last.dbp) >= 100);
    const hrvLow = isFinite(last.hrvDeltaPct) && last.hrvDeltaPct <= -7;
    const sleepLow = toNum(last.sleepEff) < 85;
    const tirLow = toNum(last.tir) < 70;
    const crpHigh = toNum(last.crp) > 3;

    // Safety-first routing
    if (/hiit|interval/.test(L)){
      if (bpHigh) return `No — SBP≥160 or DBP≥100: avoid HIIT/plyometrics. Choose mobility, isometrics, breathing, or easy Zone 2.`;
      if (hrvLow || sleepLow) return `Not today — recovery gate active (HRV low or sleep <85%). Favor easy Zone 2 + mobility; RPE ≤ 6/10.`;
      if (crpHigh) return `Caution — hs-CRP >3 mg/L suggests lower-impact work; defer HIIT until inflammation improves.`;
      return `Yes, if you have no red flags today and feel well. Keep warm-up thorough, intervals modest, and stop for any warning symptoms.`;
    }
    if (/zone ?2|aerobic|walk|cycle|bike/.test(L)){
      if (bpHigh) return `Yes, but easy only. With SBP≥160/DBP≥100, limit to easy Zone 2, mobility, or breathing; avoid high intensity.`;
      if (hrvLow || sleepLow) return `Yes — preferred on recovery days. Keep RPE ≤ 6/10 and duration modest.`;
      return `Yes — Zone 2 supports perfusion and metabolic health relevant to cognition. Keep it conversational.`;
    }
    if (/resist|strength|weights/.test(L)){
      if (hrvLow || sleepLow) return `Light resistance is acceptable during recovery (RPE ≤ 6/10); avoid heavy sets.`;
      if (tirLow) return `Yes — prioritize resistance when TIR<70%, then add easy Zone 2.`;
      return `Yes — resistance supports muscle mass, insulin sensitivity, and function. Use safe technique and progressive loads.`;
    }
    if (/bp|blood pressure|hypertens/.test(L)){
      return `If SBP≥160 or DBP≥100 today → avoid HIIT/plyometrics; choose mobility, isometrics, breathing, or easy Zone 2. Recheck BP and seek care for SBP≥180 or concerning symptoms.`;
    }
    if (/hrv/.test(L)){
      return `If HRV ≤ −7% vs baseline → deload intensity/volume. Favor easy Zone 2 + mobility; keep RPE ≤ 6/10.`;
    }
    if (/\bsleep\b/.test(L)){
      return `If sleep efficiency <85% → recovery bias: easy Zone 2, mobility, breathing; avoid maximal work.`;
    }
    if (/\bcrp\b|inflamm/.test(L)){
      return `If hs-CRP >3 mg/L → prefer low-impact aerobic and isometrics; limit impact and very high intensity until improved.`;
    }
    if (/\btir\b|time in range|glucose/.test(L)){
      return `If CGM TIR <70% → prioritize resistance training first, then easy Zone 2; consider post-meal walks.`;
    }
    if (/dual[- ]?task|cognitive|brain/.test(L)){
      return `Dual-task is encouraged for cognition. Keep RPE ≤ 6/10, progress complexity first, and apply the daily gates before intensity.`;
    }
    return `General guidance: screen daily metrics; apply gates (BP, HRV, sleep, TIR, CRP). If no red flags, progress gradually. Stop for chest pain, severe dyspnea, dizziness, or near-fall.`;
  }

  // ---- Events
  els.saveMetrics.addEventListener('click', ()=>{
    const m = readFormMetrics(true);
    if (!m) return;
    state.metrics.push(m);
    saveMetrics();
    renderPlan();
    if (document.querySelector('.tab.active')?.dataset.tab !== 'progress'){
      // hint only
    }
    alert('Saved today’s metrics.');
  });

  els.genPlan.addEventListener('click', renderPlan);
  els.libSearch.addEventListener('input', renderLibrary);
  els.libMuscleOnly.addEventListener('change', renderLibrary);

  document.getElementById('askBtn').addEventListener('click', ()=>{
    const q = document.getElementById('askInput').value.trim();
    if (!q) return;
    document.getElementById('askAnswer').textContent = deterministicAnswer(q);
  });

  els.reloadCsv.addEventListener('click', ()=> loadCsvFromPath('data/master.csv'));
  els.fileCsv.addEventListener('change', (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    Papa.parse(f, {
      header:true, dynamicTyping:true, skipEmptyLines:true,
      complete: (res)=>{
        state.rows = res.data.map(normalizeRow);
        renderLibrary();
        previewCsv(state.rows);
        alert('Loaded local CSV (not saved).');
      }
    });
  });

  els.exportBtn.addEventListener('click', ()=>{
    if (!state.metrics.length){ alert('No saved metrics.'); return; }
    const headers = ['date','hrvBaseline','hrvToday','hrvDeltaPct','sleepEff','sbp','dbp','tir','crp','notes'];
    const csv = [headers.join(',')].concat(state.metrics.map(m=>headers.map(h=>csvSafe(m[h])).join(','))).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bhe_metrics.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.clearBtn.addEventListener('click', ()=>{
    if (!confirm('This will delete all saved metrics from this browser. Continue?')) return;
    state.metrics = [];
    saveMetrics();
    drawChart();
  });

  // ---- Init
  loadMetrics();
  loadCsvFromPath('data/master.csv');
  renderLibrary();
  drawChart();
  renderPlan();

  // ---- Utils
  function readFormMetrics(validate=false){
    const base = toNum(els.hrvBaseline.value);
    const today = toNum(els.hrvToday.value);
    const sleep = toNum(els.sleepEff.value);
    const sbp = toNum(els.sbp.value);
    const dbp = toNum(els.dbp.value);
    const tir = toNum(els.tir.value);
    const crp = toNum(els.crp.value);
    if (validate && ([base,today,sleep,sbp,dbp,tir,crp].some(v=>!isFinite(v)))) {
      alert('Please complete all Today’s Inputs with valid numbers.');
      return null;
    }
    if (![base,today].every(isFinite) || base<=0) return null;
    const hrvDeltaPct = ((today - base) / base) * 100;
    return {
      date: new Date().toISOString().slice(0,10),
      hrvBaseline: base,
      hrvToday: today,
      hrvDeltaPct: round1(hrvDeltaPct),
      sleepEff: round1(sleep),
      sbp: Math.round(sbp),
      dbp: Math.round(dbp),
      tir: round1(tir),
      crp: round1(crp),
      notes: (els.notes.value || '').trim()
    };
  }
  function toNum(v){ const n = Number(v); return isFinite(n) ? n : NaN; }
  function round1(x){ return Math.round(x*10)/10; }
  function fmtPct(x){ return isFinite(x) ? `${x.toFixed(1)}%` : '—'; }
  function escapeHtml(s){ return (s??'').toString().replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function csvSafe(v){ return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v); }
})();
