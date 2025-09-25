/* Brain Health Exercise App — deterministic + optional AI addendum
   - Loads /data/master.csv with PapaParse
   - Gates: HRV Δ%, sleep %, SBP/DBP, CGM TIR, hs-CRP
   - Plan Exercise Focus radios: muscle | aerobic | both (affects scoring/filtering)
   - Library: multi-select exercise type checkboxes + focus radios
   - Saves daily snapshots in localStorage; Chart.js line chart renders immediately after save
   - Coach text: always shows non-API baseline; optionally appends AI addendum from /api/coach
   - Hidden Data tab: ?admin=1 (persist), ?admin=0 (disable), Shift+D (toggle in-session)
*/

(function(){
  // ---------- Elements ----------
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
    saveMetrics: document.getElementById('saveMetrics'),
    genPlan: document.getElementById('genPlan'),
    clearForm: document.getElementById('clearForm'),
    planSummary: document.getElementById('plan-summary'),
    planGates: document.getElementById('plan-gates'),
    planRecos: document.getElementById('plan-recos'),
    // Library
    libTypeFilters: document.getElementById('libTypeFilters'),
    libraryList: document.getElementById('library-list'),
    // Progress
    trendChartEl: document.getElementById('trendChart'),
    savedTable: document.getElementById('saved-table'),
    latestBP: document.getElementById('latest-bp'),
    latestCRP: document.getElementById('latest-crp'),
    exportBtn: document.getElementById('exportMetrics'),
    clearBtn: document.getElementById('clearMetrics'),
    // Data (admin)
    reloadCsv: document.getElementById('reloadCsv'),
    fileCsv: document.getElementById('fileCsv'),
    csvPreview: document.getElementById('csvPreview'),
    dataView: document.getElementById('data'),
    dataTabBtn: document.querySelector('.tab.admin-only'),
    disableAdmin: document.getElementById('disableAdmin'),
    // Ask
    askInput: document.getElementById('askInput'),
    askBtn: document.getElementById('askBtn'),
    askAnswer: document.getElementById('askAnswer')
  };

  const state = {
    rows: [],              // parsed CSV rows
    typesSet: new Set(),   // exercise types derived from CSV
    metrics: [],           // [{date, hrvBaseline, hrvToday, hrvDeltaPct, sleepEff, sbp, dbp, tir, crp, notes}]
    chart: null
  };

  // ---------- Admin toggle (Data tab visibility) ----------
  initAdminFlagFromURL();
  setupAdminUI();
  window.addEventListener('keydown', (e)=>{
    if (e.shiftKey && e.key.toLowerCase()==='d'){
      const cur = localStorage.getItem('bhe_admin') === '1';
      localStorage.setItem('bhe_admin', cur ? '0' : '1');
      setupAdminUI();
      alert(`Admin ${cur ? 'disabled' : 'enabled'} for this browser.`);
    }
  });

  function initAdminFlagFromURL(){
    const m = new URLSearchParams(location.search).get('admin');
    if (m === '1') localStorage.setItem('bhe_admin','1');
    if (m === '0') localStorage.setItem('bhe_admin','0');
  }
  function isAdmin(){ return localStorage.getItem('bhe_admin') === '1'; }
  function setupAdminUI(){
    const on = isAdmin();
    // Toggle Data tab button and section
    if (els.dataTabBtn) els.dataTabBtn.hidden = !on;
    if (els.dataView) els.dataView.hidden = !on;
    if (els.disableAdmin){
      els.disableAdmin.hidden = !on;
      els.disableAdmin.onclick = (e)=>{ e.preventDefault(); localStorage.setItem('bhe_admin','0'); setupAdminUI(); };
    }
  }

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      els.views.forEach(v=>v.classList.toggle('active', v.id===tab));
      if (tab==='progress') drawChart();
    });
  });

  // ---------- Storage helpers ----------
  const STORAGE_KEY = 'bhe_metrics_v1';
  function loadMetrics(){
    try { state.metrics = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { state.metrics = []; }
  }
  function saveMetrics(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.metrics)); }

  // ---------- CSV load ----------
  async function loadCsvFromPath(path='data/master.csv'){
    try {
      const res = await fetch(path, { cache:'no-cache' });
      const text = await res.text();
      const parsed = Papa.parse(text, { header:true, dynamicTyping:true, skipEmptyLines:true });
      state.rows = parsed.data.map(r => normalizeRow(r));
      buildTypeFilters(state.rows);
      renderLibrary();
      previewCsv(state.rows);
    } catch (e){
      state.rows = [];
      previewCsv([]);
      console.warn('CSV load error:', e);
    }
  }

  function normalizeRow(r){
    const out = { ...r };
    out.muscle_mass = ('' + (r.muscle_mass ?? r.MUSCLE_MASS ?? '')).trim();
    out._title = r['Exercise Type'] || r.exercise_type || r.exercise_key || 'Protocol';
    out._modality = (r.modality || r.Modality || '').toString();
    out._mod = out._modality.toLowerCase();
    out._coach = (r.coach_script_non_api || r.COACH_SCRIPT_NON_API || '').toString().trim();
    out._contra = (r.contraindications_flags || r.CONTRAINDICATIONS_FLAGS || '').toString().toLowerCase();
    out._targets = (r.cognitive_targets || r.COGNITIVE_TARGETS || '').toString();
    out._id = (r.exercise_key || out._title).toString().toLowerCase().replace(/\s+/g,'_');
    return out;
  }

  // ---------- Type filters (multiselect) ----------
  function buildTypeFilters(rows){
    state.typesSet = new Set();
    rows.forEach(row=>{
      const mods = outTokens(row._modality);
      mods.forEach(t => state.typesSet.add(t));
    });
    const frag = document.createDocumentFragment();
    Array.from(state.typesSet).sort().forEach(t=>{
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${escapeHtml(t)}" /> ${escapeHtml(titleCase(t))}`;
      frag.appendChild(label);
    });
    els.libTypeFilters.replaceChildren(frag);
    els.libTypeFilters.querySelectorAll('input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change', renderLibrary);
    });
    // Library focus radios
    document.querySelectorAll('input[name=libFocus]').forEach(r=>{
      r.addEventListener('change', renderLibrary);
    });
  }

  function outTokens(s){
    return (s||'').toLowerCase().split(/[|,/]/).map(x=>x.trim()).filter(Boolean);
  }
  function titleCase(s){
    return s.replace(/\b[a-z]/g,c=>c.toUpperCase());
  }

  // ---------- Library render ----------
  function renderLibrary(){
    const selectedTypes = Array.from(els.libTypeFilters.querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value);
    const focus = (document.querySelector('input[name=libFocus]:checked')||{}).value || 'both';
    const wrap = document.createElement('div');

    let data = state.rows.slice();
    // Focus → filter
    if (focus==='muscle') data = data.filter(r => (r.muscle_mass==='1' || r.muscle_mass===1) || /isometric|strength|resist/.test(r._mod));
    if (focus==='aerobic') data = data.filter(r => /zone ?2|aerobic|endurance|walk|cycle|bike|z2|interval|hiit|cardio/.test(r._mod));

    // Type checkboxes → filter
    if (selectedTypes.length){
      data = data.filter(r=>{
        const mods = outTokens(r._modality);
        return mods.some(m=>selectedTypes.includes(m));
      });
    }

    if (!data.length){
      els.libraryList.innerHTML = `<p class="small">No matching protocols. Adjust filters or check your CSV.</p>`;
      return;
    }

    data.forEach(row=>{
      const card = document.createElement('div');
      card.className = 'rec-card';
      const mm = (row.muscle_mass==='1'||row.muscle_mass===1) ? 'muscle_mass=1' : '';
      card.innerHTML = `
        <div class="title">${escapeHtml(row._title)}</div>
        <div class="meta">${escapeHtml(row._modality)} ${mm ? ' • '+mm : ''}</div>
        ${row._targets ? `<div class="small">${escapeHtml(row._targets)}</div>` : ``}
        <div class="coach"><strong>Coach Script:</strong> ${escapeHtml(row._coach || defaultCoachText(row, {}))}</div>
        <div id="ai_${row._id}" class="coach" style="display:none; margin-top:6px;"></div>
      `;
      wrap.appendChild(card);
      // Try to fetch AI addendum (optional)
      requestAIAddendum({
        kind: 'protocol',
        protocol: { title: row._title, modality: row._modality, coach_script_non_api: row._coach },
        baseline: defaultCoachText(row, computeFlagsFromForm()),
      }).then(add=>{
        if (!add) return;
        const el = document.getElementById(`ai_${row._id}`);
        if (el){ el.style.display='block'; el.innerHTML = `<strong>AI Coach Addendum:</strong> ${escapeHtml(add)}`; }
      }).catch(()=>{ /* silent fallback */ });
    });
    els.libraryList.replaceChildren(wrap);
  }

  // ---------- Plan generation ----------
  function computeFlagsFromForm(){
    const base = toNum(els.hrvBaseline.value);
    const today = toNum(els.hrvToday.value);
    const sleep = toNum(els.sleepEff.value);
    const sbp = toNum(els.sbp.value);
    const dbp = toNum(els.dbp.value);
    const tir = toNum(els.tir.value);
    const crp = toNum(els.crp.value);
    const hrvDeltaPct = (isFinite(base)&&base>0 && isFinite(today)) ? ((today-base)/base)*100 : NaN;
    return {
      hrvDeltaPct,
      sleepEff: sleep,
      sbp, dbp, tir, crp,
      hrvLow: isFinite(hrvDeltaPct) && hrvDeltaPct <= -7,
      sleepLow: sleep < 85,
      bpHigh: (sbp >= 160 || dbp >= 100),
      tirLow: tir < 70,
      crpHigh: crp > 3
    };
  }

  function computePlan(){
    if (!state.rows.length) return { summary:'No CSV rows loaded.', gates:[], recos:[] };
    const flags = computeFlagsFromForm();
    if (!isFinite(flags.hrvDeltaPct)) return { summary:'Please complete Today’s Inputs first.', gates:[], recos:[] };

    const gates = [];
    if (flags.bpHigh)  gates.push({tag:'Hypertension (SBP≥160 or DBP≥100): avoid HIIT/plyo', level:'bad'});
    if (flags.hrvLow)  gates.push({tag:'HRV low (≤ −7% vs baseline): deload', level:'warn'});
    if (flags.sleepLow)gates.push({tag:'Sleep efficiency <85%: deload', level:'warn'});
    if (flags.tirLow)  gates.push({tag:'CGM TIR <70%: prioritize resistance + Zone 2', level:'warn'});
    if (flags.crpHigh) gates.push({tag:'hs-CRP >3 mg/L: prefer low-impact + isometrics', level:'warn'});

    const planFocus = (document.querySelector('input[name=planFocus]:checked')||{}).value || 'both';

    // Score rows based on gates + focus
    const scored = [];
    for (const row of state.rows){
      const mod = row._mod;
      const isRes  = /resist|strength|weights|rt|lift/.test(mod);
      const isZ2   = /zone ?2|aerobic|endurance|walk|cycle|bike|z2|cardio/.test(mod);
      const isMob  = /mobility|stretch|flex/.test(mod);
      const isIso  = /isometric|isometrics|iso/.test(mod);
      const isHIIT = /hiit|interval/.test(mod);
      const isPlyo = /plyo/.test(mod);

      let score = 1;

      // Focus bias
      if (planFocus==='muscle'){
        if (row.muscle_mass==='1' || row.muscle_mass===1) score += 6;
        if (isRes || isIso) score += 3;
        if (isZ2) score -= 1;
      } else if (planFocus==='aerobic'){
        if (isZ2) score += 4;
        if (isMob) score += 1;
        if (isRes) score -= 1; // still allowed but deprioritized
      } else {
        // both: slight preference to safer modalities first
        if (isZ2 || isMob) score += 2;
      }

      // Gates
      if (flags.bpHigh){ if (isHIIT || isPlyo) score -= 50; if (isMob || isZ2) score += 4; if (isIso) score += 3; }
      if (flags.hrvLow || flags.sleepLow){ if (isZ2) score += 4; if (isMob) score += 3; if (isHIIT||isPlyo) score -= 6; if (isRes) score -= 1; }
      if (flags.tirLow){ if (isRes) score += 5; if (isZ2) score += 3; }
      if (flags.crpHigh){ if (isIso || isZ2) score += 3; if (isPlyo || isHIIT) score -= 3; }

      if (row._contra.includes('hiit') || row._contra.includes('plyo')) score -= 2;

      scored.push({ row, score });
    }

    scored.sort((a,b)=>b.score - a.score);
    const top = scored.slice(0,5).map(t=>t.row);

    const summary = [
      `HRV Δ%: ${fmtPct(flags.hrvDeltaPct)}  |  Sleep: ${round1(flags.sleepEff)}%  |  BP: ${flags.sbp}/${flags.dbp}  |  TIR: ${round1(flags.tir)}%  |  hs-CRP: ${round1(flags.crp)} mg/L`,
      flags.bpHigh  ? `• High BP gate → avoid HIIT/plyo; prefer mobility, isometrics, easy Zone 2.` : ``,
      (flags.hrvLow || flags.sleepLow) ? `• Recovery gate → deload; emphasize Zone 2 + mobility.` : ``,
      flags.tirLow  ? `• TIR <70% → resistance first, then Zone 2; add post-meal walks.` : ``,
      flags.crpHigh ? `• CRP >3 → low-impact aerobic/isometrics; limit impact until improved.` : ``,
    ].filter(Boolean).join('\n');

    return { summary, gates, top, flags };
  }

  function renderPlan(){
    const res = computePlan();
    els.planSummary.textContent = res.summary || '';
    // badges
    const frag = document.createDocumentFragment();
    if (!res.gates.length) frag.appendChild(badge('No active safety gates','ok'));
    else res.gates.forEach(g=>frag.appendChild(badge(g.tag,g.level)));
    els.planGates.replaceChildren(frag);

    // recos
    const wrap = document.createElement('div');
    (res.top || []).forEach(row=>{
      const mm = (row.muscle_mass==='1'||row.muscle_mass===1) ? 'muscle_mass=1' : '';
      const id = row._id;
      const coachBaseline = (row._coach ? row._coach + ' ' : '') + defaultCoachText(row, res.flags);
      const div = document.createElement('div');
      div.className = 'rec-card';
      div.innerHTML = `
        <div class="title">${escapeHtml(row._title)}</div>
        <div class="meta">${escapeHtml(row._modality)} ${mm ? ' • '+mm : ''}</div>
        ${row._targets ? `<div class="small">${escapeHtml(row._targets)}</div>` : ``}
        <div class="coach"><strong>Coach Script:</strong> ${escapeHtml(coachBaseline)}</div>
        <div id="ai_${id}" class="coach" style="display:none; margin-top:6px;"></div>
      `;
      wrap.appendChild(div);

      // Optional AI addendum (try; fallback silent). Limit to top 3 to reduce cost/latency.
      if ((res.top||[]).slice(0,3).includes(row)){
        requestAIAddendum({
          kind:'protocol',
          protocol: { title: row._title, modality: row._modality, coach_script_non_api: row._coach },
          metrics: minimalMetrics(),
          gates: summarizeGates(res.flags),
          baseline: coachBaseline
        }).then(add=>{
          if (!add) return;
          const el = document.getElementById(`ai_${id}`);
          if (el){ el.style.display='block'; el.innerHTML = `<strong>AI Coach Addendum:</strong> ${escapeHtml(add)}`; }
        }).catch(()=>{ /* ignore */ });
      }
    });
    els.planRecos.replaceChildren(wrap);
  }

  function badge(text, level){
    const span = document.createElement('span');
    span.className = `badge ${level||''}`;
    span.textContent = text;
    return span;
  }

  function defaultCoachText(row, f){
    const bits = [];
    if (f.bpHigh)  bits.push('Avoid HIIT/plyometrics today; choose lower-impact work.');
    if (f.hrvLow || f.sleepLow) bits.push('Deload intensity/volume; keep RPE ≤ 6/10.');
    if (f.tirLow)  bits.push('Resistance first (glycemic benefit), then easy Zone 2.');
    if (f.crpHigh) bits.push('Favor isometrics/low-impact aerobic; limit impact until CRP improves.');
    return bits.join(' ') || 'Follow conservative progression and stop for warning symptoms.';
  }

  // ---------- Data preview ----------
  function previewCsv(rows){
    if (!rows || !rows.length){
      if (els.csvPreview) els.csvPreview.innerHTML = `<p class="small">No data loaded. Ensure <code>/data/master.csv</code> exists.</p>`;
      return;
    }
    const headers = Object.keys(rows[0]);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.slice(0,10).forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.slice(0,20).forEach(r=>{
      const tr = document.createElement('tr');
      headers.slice(0,10).forEach(h=>{ const td=document.createElement('td'); td.textContent = (r[h] ?? '').toString(); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    if (els.csvPreview) els.csvPreview.replaceChildren(table);
  }

  // ---------- Progress (chart + table) ----------
  function drawChart(){
    const labels = state.metrics.map(m=>m.date);
    const hrv = state.metrics.map(m=>m.hrvDeltaPct);
    const sleep = state.metrics.map(m=>m.sleepEff);
    const tir = state.metrics.map(m=>m.tir);

    if (!els.trendChartEl) return;

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
          scales: { y: { beginAtZero: true } }
        }
      });
    }

    // latest vitals
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

  // ---------- Ask (baseline + optional AI addendum) ----------
  function deterministicAnswer(q){
    const L = q.toLowerCase();
    const last = state.metrics[state.metrics.length-1] || minimalMetrics();
    const bpHigh = (toNum(last.sbp) >= 160 || toNum(last.dbp) >= 100);
    const hrvLow = isFinite(last.hrvDeltaPct) && last.hrvDeltaPct <= -7;
    const sleepLow = toNum(last.sleepEff) < 85;
    const tirLow = toNum(last.tir) < 70;
    const crpHigh = toNum(last.crp) > 3;

    if (/hiit|interval/.test(L)){
      if (bpHigh) return `No — SBP≥160 or DBP≥100: avoid HIIT/plyometrics. Choose mobility, isometrics, breathing, or easy Zone 2.`;
      if (hrvLow || sleepLow) return `Not today — recovery gate active. Favor easy Zone 2 + mobility; RPE ≤ 6/10.`;
      if (crpHigh) return `Caution — hs-CRP >3 mg/L: prefer lower-impact work; defer HIIT until improved.`;
      return `Yes if no red flags. Warm up thoroughly; keep intervals modest; stop for any warning symptoms.`;
    }
    if (/zone ?2|aerobic|walk|cycle|bike/.test(L)){
      if (bpHigh) return `Yes, but easy only. With SBP≥160/DBP≥100, limit to easy Zone 2/mobility/breathing; avoid high intensity.`;
      if (hrvLow || sleepLow) return `Yes — preferred on recovery days. Keep RPE ≤ 6/10 and duration modest.`;
      return `Yes — Zone 2 supports perfusion and metabolic health relevant to cognition. Keep it conversational.`;
    }
    if (/resist|strength|weights/.test(L)){
      if (hrvLow || sleepLow) return `Light resistance is acceptable during recovery (RPE ≤ 6/10); avoid heavy sets.`;
      if (tirLow) return `Yes — prioritize resistance when TIR<70%, then add easy Zone 2.`;
      return `Yes — resistance supports muscle mass, insulin sensitivity, and function. Use safe technique and progressive loads.`;
    }
    if (/bp|blood pressure|hypertens/.test(L)){
      return `If SBP≥160 or DBP≥100 → avoid HIIT/plyometrics; choose mobility, isometrics, breathing, or easy Zone 2. Recheck BP; seek care for SBP≥180 or concerning symptoms.`;
    }
    if (/hrv/.test(L)){ return `If HRV ≤ −7% vs baseline → deload intensity/volume. Favor easy Zone 2 + mobility; RPE ≤ 6/10.`; }
    if (/\bsleep\b/.test(L)){ return `If sleep efficiency <85% → recovery bias: easy Zone 2, mobility, breathing; avoid maximal work.`; }
    if (/\bcrp\b|inflamm/.test(L)){ return `If hs-CRP >3 mg/L → prefer low-impact aerobic and isometrics; limit impact and very high intensity until improved.`; }
    if (/\btir\b|time in range|glucose/.test(L)){ return `If CGM TIR <70% → prioritize resistance first, then easy Zone 2; consider post-meal walks.`; }
    if (/dual[- ]?task|cognitive|brain/.test(L)){ return `Dual-task is encouraged for cognition. Keep RPE ≤ 6/10, progress complexity first, and apply daily gates before intensity.`; }
    return `Screen daily metrics; apply gates (BP, HRV, sleep, TIR, CRP). If no red flags, progress gradually. Stop for chest pain, severe dyspnea, dizziness, or near-fall.`;
  }

  // ---------- Events ----------
  els.saveMetrics.addEventListener('click', ()=>{
    const m = readFormMetrics(true);
    if (!m) return;
    state.metrics.push(m);
    saveMetrics();
    drawChart();               // ensures line chart shows immediately
    renderPlan();
    alert('Saved today’s metrics.');
  });

  els.genPlan.addEventListener('click', renderPlan);

  els.clearForm.addEventListener('click', ()=>{
    ['hrvBaseline','hrvToday','sleepEff','sbp','dbp','tir','crp','notes'].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.querySelector('input[name=planFocus][value=both]').checked = true;
    els.planSummary.textContent = '';
    els.planGates.replaceChildren();
    els.planRecos.replaceChildren();
  });

  if (els.reloadCsv) els.reloadCsv.addEventListener('click', ()=> loadCsvFromPath('data/master.csv'));
  if (els.fileCsv) els.fileCsv.addEventListener('change', (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    Papa.parse(f, {
      header:true, dynamicTyping:true, skipEmptyLines:true,
      complete: (res)=>{
        state.rows = res.data.map(normalizeRow);
        buildTypeFilters(state.rows);
        renderLibrary();
        previewCsv(state.rows);
        alert('Loaded local CSV (not saved).');
      }
    });
  });

  if (els.exportBtn) els.exportBtn.addEventListener('click', ()=>{
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

  if (els.clearBtn) els.clearBtn.addEventListener('click', ()=>{
    if (!confirm('This will delete all saved metrics from this browser. Continue?')) return;
    state.metrics = [];
    saveMetrics();
    drawChart();
  });

  if (els.askBtn) els.askBtn.addEventListener('click', async ()=>{
    const q = (els.askInput.value || '').trim();
    if (!q) return;
    const baseline = deterministicAnswer(q);
    els.askAnswer.textContent = `Baseline Answer:\n${baseline}`;

    try {
      const add = await requestAIAddendum({
        kind:'ask',
        query:q,
        metrics: minimalMetrics(),
        gates: summarizeGates(computeFlagsFromForm()),
        baseline
      });
      if (add){
        els.askAnswer.textContent += `\n\nAI Coach Addendum:\n${add}`;
      }
    } catch {
      // silent fallback
    }
  });

  // ---------- Init ----------
  loadMetrics();
  loadCsvFromPath('data/master.csv');
  renderLibrary();
  drawChart();
  renderPlan();

  // ---------- AI addendum helper ----------
  async function requestAIAddendum(payload){
    // Try the Netlify function; return empty string on error.
    try {
      const res = await fetch('/api/coach', {
        method:'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(sanitizePayload(payload))
      });
      if (!res.ok) return '';
      const data = await res.json();
      const add = (data && data.addendum || '').toString().trim();
      return add;
    } catch(e){
      return '';
    }
  }

  function sanitizePayload(p){
    // Keep only non-identifying, minimal fields
    const out = { kind:p.kind, baseline:p.baseline||'' };
    if (p.query) out.query = String(p.query).slice(0,500);
    if (p.protocol){
      out.protocol = {
        title: (p.protocol.title||'').toString(),
        modality: (p.protocol.modality||'').toString()
      };
    }
    if (p.metrics) out.metrics = p.metrics;
    if (p.gates) out.gates = p.gates;
    return out;
  }

  function minimalMetrics(){
    const m = state.metrics[state.metrics.length-1] || readFormMetrics(false) || {};
    return {
      hrvDeltaPct: toNum(m.hrvDeltaPct),
      sleepEff: toNum(m.sleepEff),
      sbp: toNum(m.sbp),
      dbp: toNum(m.dbp),
      tir: toNum(m.tir),
      crp: toNum(m.crp)
    };
  }

  function summarizeGates(f){
    return {
      bpHigh: !!f.bpHigh,
      hrvLow: !!f.hrvLow,
      sleepLow: !!f.sleepLow,
      tirLow: !!f.tirLow,
      crpHigh: !!f.crpHigh
    };
  }

  // ---------- Utilities ----------
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
