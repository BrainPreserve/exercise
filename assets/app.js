/* Brain Health Exercise App (deterministic + optional AI addendum)
   - Loads /data/master.csv (same origin)
   - Safety/adaptation gates: HRV Δ%, sleep %, SBP/DBP, CGM TIR, hs-CRP
   - Plan "Exercise Focus" radios (muscle / aerobic / both)
   - Library: Protocol Finder (goals, types, time, equipment, focus)
   - Saves daily snapshots; line chart renders immediately after Save
   - Ask tab: deterministic baseline + optional AI addendum
   - Hidden Data tab via ?admin=1 (or Shift+D). ?admin=0 hides it.
*/

(function () {
  // ---------- ELEMENTS ----------
  const $ = (sel) => document.querySelector(sel);
  const els = {
    tabs: document.querySelectorAll('.tab'),
    views: document.querySelectorAll('.view'),
    // Plan form
    hrvBaseline: $('#hrvBaseline'),
    hrvToday: $('#hrvToday'),
    sleepEff: $('#sleepEff'),
    sbp: $('#sbp'),
    dbp: $('#dbp'),
    tir: $('#tir'),
    crp: $('#crp'),
    notes: $('#notes'),
    planSummary: $('#plan-summary'),
    planGates: $('#plan-gates'),
    planRecos: $('#plan-recos'),
    saveMetrics: $('#saveMetrics'),
    genPlan: $('#genPlan'),
    clearForm: $('#clearForm'),
    // Library finder
    goalFilters: $('#goalFilters'),
    libTypeFilters: $('#libTypeFilters'),
    equipFilters: $('#equipFilters'),
    applyFinder: $('#applyFinder'),
    clearFinder: $('#clearFinder'),
    // Progress
    chartCanvas: $('#trendChart'),
    savedTable: $('#saved-table'),
    latestBP: $('#latest-bp'),
    latestCRP: $('#latest-crp'),
    exportBtn: $('#exportMetrics'),
    clearBtn: $('#clearMetrics'),
    // Ask
    askInput: $('#askInput'),
    askBtn: $('#askBtn'),
    askAnswer: $('#askAnswer'),
    // Data (admin)
    dataSection: $('#data'),
    dataTabBtn: document.querySelector('.tab.admin-only'),
    disableAdmin: $('#disableAdmin'),
    reloadCsv: $('#reloadCsv'),
    fileCsv: $('#fileCsv'),
    csvPreview: $('#csvPreview')
  };

  // ---------- STATE ----------
  const STORAGE_KEY = 'bhe_metrics_v1';
  const ADMIN_KEY = 'bhe_admin';
  const state = {
    rows: [],           // parsed CSV rows (normalized)
    types: new Set(),   // exercise type tokens, derived from CSV
    metrics: [],        // saved daily metrics snapshots
    chart: null
  };

  // ---------- ADMIN TOGGLE (Data tab) ----------
  initAdmin();
  function initAdmin(){
    const params = new URLSearchParams(location.search);
    if (params.has('admin')) {
      const flag = params.get('admin') === '1';
      localStorage.setItem(ADMIN_KEY, flag ? '1' : '0');
      history.replaceState({}, '', location.pathname); // clean URL
    }
    const on = localStorage.getItem(ADMIN_KEY) === '1';
    if (on) {
      els.dataTabBtn.hidden = false;
      els.disableAdmin.hidden = false;
      els.dataSection.hidden = false;
      els.disableAdmin.addEventListener('click', (e)=>{ e.preventDefault(); localStorage.setItem(ADMIN_KEY,'0'); location.reload(); });
    }
    // keyboard shortcut (Shift + D)
    document.addEventListener('keydown', (e)=>{
      if (e.shiftKey && e.key.toLowerCase()==='d'){
        const to = localStorage.getItem(ADMIN_KEY)==='1' ? '0' : '1';
        localStorage.setItem(ADMIN_KEY, to);
        location.reload();
      }
    });
  }

  // ---------- TABS ----------
  els.tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      els.tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      els.views.forEach(v=>v.classList.toggle('active', v.id===tab));
      if (tab==='progress') drawChart();
    });
  });

  // ---------- STORAGE ----------
  function loadMetrics(){
    try { state.metrics = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { state.metrics = []; }
  }
  function saveMetrics(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.metrics));
  }

  // ---------- CSV LOAD ----------
  async function loadCsvFromPath(path='data/master.csv'){
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      const text = await res.text();
      const parsed = Papa.parse(text, { header:true, dynamicTyping:true, skipEmptyLines:true });
      state.rows = parsed.data.map(normalizeRow).filter(Boolean);
      rebuildTypeFilters(state.rows);
      renderLibrary();   // initial render (no filters)
      previewCsv(state.rows); // admin
    } catch (e){
      state.rows = [];
      previewCsv([]);
      console.warn('CSV load error:', e);
    }
  }

  function normalizeRow(r){
    if (!r) return null;
    const title = (r['Exercise Type'] || r.exercise_type || r.exercise_key || '').toString().trim();
    if (!title) return null;

    const modality = (r.modality || '').toString().toLowerCase();
    const mm = ('' + (r.muscle_mass ?? r.MUSCLE_MASS ?? '')).trim();
    const coach = (r.coach_script_non_api || r.COACH_SCRIPT_NON_API || '').toString().trim();
    const targets = (r.cognitive_targets || r.COGNITIVE_TARGETS || '').toString();
    const mech = (r.mechanism_tags || r.MECHANISM_TAGS || '').toString().toLowerCase();
    const hooks = (r.biomarker_hooks || r.BIOMARKER_HOOKS || '').toString().toLowerCase();
    const contra = (r.contraindications_flags || r.CONTRAINDICATIONS_FLAGS || '').toString().toLowerCase();
    const equip = (r.home_equipment || r.HOME_EQUIPMENT || '').toString().toLowerCase();
    const time_min = Number(r.time_min || 0);

    return {
      raw: r,
      title,
      modality,
      muscle_mass: (mm==='1' || mm==='true' || mm===1) ? 1 : 0,
      coach,
      targets,
      mech,
      hooks,
      contra,
      equip,
      time_min: isFinite(time_min) && time_min>0 ? time_min : 30,
      // canonical type tokens (derived)
      types: deriveTypes(title, modality)
    };
  }

  function deriveTypes(title, modality){
    const blob = `${title} ${modality}`.toLowerCase();
    const out = new Set();
    if (/\b(hiit|interval)\b/.test(blob)) out.add('hiit');
    if (/\b(zone ?2|endurance|aerobic|walk|bike|cycle|treadmill|z2)\b/.test(blob)) out.add('aerobic');
    if (/\b(resist|strength|weights|rt|lift)\b/.test(blob)) out.add('resistance');
    if (/\b(isometric|isometrics|iso)\b/.test(blob)) out.add('isometrics');
    if (/\b(mobility|flex|stretch)\b/.test(blob)) out.add('mobility');
    if (/\b(dual[- ]?task|cognitive overlay)\b/.test(blob)) out.add('dual_task');
    if (/\b(plyo)\b/.test(blob)) out.add('plyometrics');
    if (out.size===0) out.add('other');
    return out;
  }

  function rebuildTypeFilters(rows){
    state.types = new Set();
    rows.forEach(row=> row.types.forEach(t=> state.types.add(t)));
    const container = els.libTypeFilters;
    container.innerHTML = '';
    Array.from(state.types).sort().forEach(t=>{
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${t}"/> ${prettyType(t)}`;
      container.appendChild(label);
    });
  }

  function prettyType(t){
    const map = {
      aerobic:'Aerobic/Zone 2',
      hiit:'Intervals/HIIT',
      resistance:'Resistance',
      isometrics:'Isometrics',
      mobility:'Mobility',
      dual_task:'Dual-task',
      plyometrics:'Plyometrics',
      other:'Other'
    };
    return map[t] || t;
  }

  // ---------- PROTOCOL FINDER HELPERS ----------
  function getFinderSelections(){
    const goals = Array.from(els.goalFilters.querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value);
    const types = Array.from(els.libTypeFilters.querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value);
    const equipment = Array.from(els.equipFilters.querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value);
    const timeAvail = (document.querySelector('input[name=timeAvail]:checked')?.value || '30');
    const focus = (document.querySelector('input[name=libFocus]:checked')?.value || 'both');
    return { goals, types, equipment, timeAvail: Number(timeAvail), focus };
  }

  // ---------- PLAN COMPUTE ----------
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

  function computeGates(m){
    return {
      bpHigh: (m.sbp >= 160 || m.dbp >= 100),
      hrvLow: (isFinite(m.hrvDeltaPct) && m.hrvDeltaPct <= -7),
      sleepLow: (m.sleepEff < 85),
      tirLow: (m.tir < 70),
      crpHigh: (m.crp > 3)
    };
  }

  function computePlan(){
    if (!state.rows.length) return { summary:'No CSV rows loaded.', gates:[], recos:[] };
    const m = readFormMetrics(true); if (!m) return { summary:'Please complete Today’s Inputs.', gates:[], recos:[] };
    const flags = computeGates(m);

    const planFocus = (document.querySelector('input[name=planFocus]:checked')?.value || 'both');

    // Gates badges
    const gates = [];
    if (flags.bpHigh)   gates.push({tag:'Hypertension (SBP≥160 or DBP≥100): avoid HIIT/plyo', level:'bad'});
    if (flags.hrvLow)   gates.push({tag:'HRV low (≤ −7% vs baseline): deload', level:'warn'});
    if (flags.sleepLow) gates.push({tag:'Sleep efficiency <85%: deload', level:'warn'});
    if (flags.tirLow)   gates.push({tag:'CGM TIR <70%: prioritize resistance + Zone 2', level:'warn'});
    if (flags.crpHigh)  gates.push({tag:'hs-CRP >3 mg/L: prefer low-impact + isometrics', level:'warn'});

    // Score protocols
    const scored = scoreProtocols(state.rows, flags, {
      focus: planFocus,
      goals: [], types: [], equipment: [], timeAvail: 30
    });

    const top = scored.slice(0,5);
    const summary = [
      `HRV Δ%: ${fmtPct(m.hrvDeltaPct)}  |  Sleep: ${m.sleepEff}%  |  BP: ${m.sbp}/${m.dbp}  |  TIR: ${m.tir}%  |  hs-CRP: ${m.crp} mg/L`,
      flags.bpHigh   ? `• High BP gate → avoid HIIT/plyo; favor mobility, isometrics, easy Zone 2.` : ``,
      (flags.hrvLow || flags.sleepLow) ? `• Recovery gate → deload; emphasize Zone 2 + mobility.` : ``,
      flags.tirLow   ? `• Glycemic focus → resistance first, then Zone 2; add post-meal walks.` : ``,
      flags.crpHigh  ? `• Inflammation high → low-impact work; favor isometrics/Zone 2.` : ``
    ].filter(Boolean).join('\n');

    const recos = top.map(t=>{
      const baseline = defaultCoachText(t.row, flags);
      return {
        title: t.row.title,
        meta: metaLine(t.row),
        coach: baseline,
        aiHook: { row: t.row, flags }  // for optional AI addendum
      };
    });

    return { m, flags, summary, gates, recos };
  }

  function scoreProtocols(rows, flags, finder){
    const out = [];
    for (const row of rows){
      // focus filter
      if (finder.focus==='muscle' && row.muscle_mass!==1) continue;
      if (finder.focus==='aerobic' && !row.types.has('aerobic')) continue;

      // type filter (if any selected)
      if (finder.types?.length){
        let ok = false;
        for (const t of finder.types){ if (row.types.has(t)) { ok=true; break; } }
        if (!ok) continue;
      }

      // equipment filter (simple contains)
      if (finder.equipment?.length){
        const eq = row.equip;
        const matched = finder.equipment.some(tag => eq.includes(tag) || (tag==='none' && !eq));
        if (!matched) continue;
      }

      // time filter
      if (row.time_min > finder.timeAvail) continue;

      // base score
      let score = 1;

      // gates → bias
      const isRes = row.types.has('resistance');
      const isZ2 = row.types.has('aerobic');
      const isMob = row.types.has('mobility');
      const isIso = row.types.has('isometrics');
      const isHIIT = row.types.has('hiit');
      const isPlyo = row.types.has('plyometrics');

      if (flags.bpHigh){ if (isHIIT||isPlyo) score-=50; if (isMob||isZ2) score+=4; if (isIso) score+=3; }
      if (flags.hrvLow||flags.sleepLow){ if (isZ2) score+=4; if (isMob) score+=3; if (isHIIT||isPlyo) score-=6; if (isRes) score-=1; }
      if (flags.tirLow){ if (isRes) score+=5; if (isZ2) score+=3; }
      if (flags.crpHigh){ if (isIso||isZ2) score+=3; if (isPlyo||isHIIT) score-=3; }

      // goals → bias
      const g = finder.goals || [];
      if (g.includes('muscle') && row.muscle_mass===1) score+=4;
      if (g.includes('vo2') && isZ2) score+=3;
      if (g.includes('weight') && (isZ2||isHIIT)) score+=2;
      if (g.includes('glycemic') && (isRes||isZ2)) score+=3;
      if (g.includes('bp') && (isIso||isZ2||isMob)) score+=2;
      if (g.includes('balance') && (row.mech.includes('balance')||row.targets.toLowerCase().includes('fall'))) score+=2;
      if (g.includes('sleep') && (row.mech.includes('hrv')||row.mech.includes('sleep'))) score+=2;

      // contraindications
      if (row.contra.includes('hiit') || row.contra.includes('plyo')) score -= 2;

      out.push({ row, score });
    }
    out.sort((a,b)=>b.score-a.score);
    return out;
  }

  function defaultCoachText(row, flags){
    const bits = [];
    if (flags.bpHigh)  bits.push('Avoid HIIT/plyometrics today; choose lower-impact work.');
    if (flags.hrvLow || flags.sleepLow) bits.push('Deload intensity/volume; keep RPE ≤ 6/10.');
    if (flags.tirLow)  bits.push('Resistance first (glycemic benefit), then easy Zone 2.');
    if (flags.crpHigh) bits.push('Favor isometrics/low-impact aerobic; limit impact until CRP improves.');
    const base = row.coach && row.coach.length ? `Coach Script: ${row.coach}` : '';
    return [base, bits.join(' ')].filter(Boolean).join(' ');
  }

  function metaLine(row){
    const parts = [];
    parts.push([...row.types].map(prettyType).join(' / ') || '—');
    if (row.muscle_mass===1) parts.push('muscle_mass=1');
    if (row.targets) parts.push(row.targets);
    return parts.join(' • ');
  }

  // ---------- RENDERERS ----------
  function renderPlan(){
    const { m, flags, summary, gates, recos } = computePlan();
    els.planSummary.textContent = summary || '';

    // badges
    const frag = document.createDocumentFragment();
    if (!gates.length) frag.appendChild(badge('No active safety gates', 'ok'));
    else gates.forEach(g=> frag.appendChild(badge(g.tag, g.level)));
    els.planGates.replaceChildren(frag);

    // recos
    const wrap = document.createElement('div');
    recos.forEach(async r=>{
      const div = document.createElement('div');
      div.className = 'rec-card';
      div.innerHTML = `
        <div class="title">${escapeHtml(r.title)}</div>
        <div class="meta">${escapeHtml(r.meta)}</div>
        <div class="coach"><h4>Coach Script</h4>${escapeHtml(r.coach)}</div>
      `;
      wrap.appendChild(div);

      // Optional AI addendum
      const add = await fetchCoachAddendum({
        context: 'plan_protocol',
        title: r.aiHook.row.title,
        types: [...r.aiHook.row.types],
        muscle_mass: r.aiHook.row.muscle_mass,
        notes: r.aiHook.row.coach,
        metrics: currentMetricsForApi(),
        gates: r.aiHook.flags
      });
      if (add) {
        const ai = document.createElement('div');
        ai.className = 'coach';
        ai.innerHTML = `<h4>AI Coaching Insights</h4>${escapeHtml(add)}`;
        div.appendChild(ai);
      }
    });
    els.planRecos.replaceChildren(wrap);
  }

  function renderLibrary(){
    const sel = getFinderSelections();
    const m = readFormMetrics(false) || lastSavedMetrics() || {
      hrvDeltaPct: NaN, sleepEff: NaN, sbp: NaN, dbp: NaN, tir: NaN, crp: NaN
    };
    const flags = computeGates({
      hrvDeltaPct: m.hrvDeltaPct, sleepEff: m.sleepEff, sbp: m.sbp, dbp: m.dbp, tir: m.tir, crp: m.crp
    });
    const scored = scoreProtocols(state.rows, flags, sel).slice(0, 50);

    const list = document.createElement('div');
    if (!scored.length){
      list.innerHTML = `<p class="small">No matching protocols with current filters.</p>`;
    } else {
      for (const s of scored){
        const card = document.createElement('div');
        card.className = 'rec-card';
        card.innerHTML = `
          <div class="title">${escapeHtml(s.row.title)}</div>
          <div class="meta">${escapeHtml(metaLine(s.row))}</div>
          <div class="coach"><h4>Coach Script</h4>${escapeHtml(defaultCoachText(s.row, flags))}</div>
        `;
        list.appendChild(card);

        // Optional AI addendum per card
        fetchCoachAddendum({
          context: 'library_protocol',
          title: s.row.title,
          types: [...s.row.types],
          muscle_mass: s.row.muscle_mass,
          notes: s.row.coach,
          metrics: currentMetricsForApi(),
          gates: flags
        }).then(add=>{
          if (!add) return;
          const ai = document.createElement('div');
          ai.className = 'coach';
          ai.innerHTML = `<h4>AI Coaching Insights</h4>${escapeHtml(add)}`;
          card.appendChild(ai);
        });
      }
    }
    $('#library-list').replaceChildren(list);
  }

  function badge(text, level){
    const span = document.createElement('span');
    span.className = `badge ${level||''}`;
    span.textContent = text;
    return span;
  }

  function previewCsv(rows){
    if (!els.csvPreview) return;
    if (!rows || !rows.length){
      els.csvPreview.innerHTML = `<p class="small">No data loaded. Ensure <code>/data/master.csv</code> exists.</p>`;
      return;
    }
    const headers = Object.keys(rows[0].raw);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.slice(0,10).forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); });
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.slice(0,20).forEach(r=>{
      const tr = document.createElement('tr');
      headers.slice(0,10).forEach(h=>{
        const td = document.createElement('td');
        td.textContent = (r.raw[h] ?? '').toString();
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    els.csvPreview.replaceChildren(table);
  }

  // ---------- CHART ----------
  function drawChart(){
    const labels = state.metrics.map(m=>m.date);
    const hrv = state.metrics.map(m=>m.hrvDeltaPct);
    const sleep = state.metrics.map(m=>m.sleepEff);
    const tir = state.metrics.map(m=>m.tir);

    if (!els.chartCanvas) return;

    if (state.chart){
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = hrv;
      state.chart.data.datasets[1].data = sleep;
      state.chart.data.datasets[2].data = tir;
      state.chart.update();
    } else {
      const ctx = els.chartCanvas.getContext('2d');
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
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
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

  // ---------- ASK ----------
  els.askBtn?.addEventListener('click', async ()=>{
    const q = (els.askInput.value || '').trim();
    if (!q) return;
    const base = deterministicAnswer(q, lastSavedMetrics() || readFormMetrics(false) || {});
    let out = `Baseline Answer:\n${base}`;
    const add = await fetchCoachAddendum({
      context: 'ask',
      question: q,
      metrics: currentMetricsForApi(),
      gates: lastSavedMetrics() ? computeGates(lastSavedMetrics()) : (readFormMetrics(false) ? computeGates(readFormMetrics(false)) : {})
    });
    if (add) out += `\n\nAI Coach Addendum:\n${add}`;
    els.askAnswer.textContent = out;
  });

  function deterministicAnswer(q, last){
    const L = q.toLowerCase();
    const bpHigh = (toNum(last.sbp) >= 160 || toNum(last.dbp) >= 100);
    const hrvLow = isFinite(last.hrvDeltaPct) && last.hrvDeltaPct <= -7;
    const sleepLow = toNum(last.sleepEff) < 85;
    const tirLow = toNum(last.tir) < 70;
    const crpHigh = toNum(last.crp) > 3;

    if (/hiit|interval/.test(L)){
      if (bpHigh) return `No — SBP≥160 or DBP≥100: avoid HIIT/plyometrics. Choose mobility, isometrics, breathing, or easy Zone 2.`;
      if (hrvLow || sleepLow) return `Not today — recovery gate active (HRV low or sleep <85%). Favor easy Zone 2 + mobility; RPE ≤ 6/10.`;
      if (crpHigh) return `Caution — hs-CRP >3 mg/L suggests lower-impact work; defer HIIT until inflammation improves.`;
      return `Yes, if no red flags and you feel well. Warm up thoroughly; keep intervals modest; stop for warning symptoms.`;
    }
    if (/zone ?2|aerobic|walk|cycle|bike/.test(L)){
      if (bpHigh) return `Yes, but easy only. With SBP≥160/DBP≥100, limit to easy Zone 2/mobility/breathing; avoid high intensity.`;
      if (hrvLow || sleepLow) return `Yes — preferred on recovery days. Keep RPE ≤ 6/10 and duration modest.`;
      return `Yes — Zone 2 supports perfusion and metabolic health relevant to cognition. Keep it conversational.`;
    }
    if (/resist|strength|weights/.test(L)){
      if (hrvLow || sleepLow) return `Light resistance is acceptable during recovery (RPE ≤ 6/10); avoid heavy sets.`;
      if (tirLow) return `Yes — prioritize resistance when TIR <70%, then add easy Zone 2.`;
      return `Yes — resistance supports muscle mass, insulin sensitivity, and function. Use safe technique and progressive loads.`;
    }
    if (/\bbp\b|blood pressure|hypertens/.test(L)){
      return `If SBP≥160 or DBP≥100 → avoid HIIT/plyometrics; choose mobility, isometrics, breathing, or easy Zone 2. Seek care for SBP≥180 or concerning symptoms.`;
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
      return `If CGM TIR <70% → prioritize resistance first, then easy Zone 2; include post-meal walks.`;
    }
    if (/dual[- ]?task|cognitive|brain/.test(L)){
      return `Dual-task is encouraged for cognition. Keep RPE ≤ 6/10, progress complexity first, and apply the daily gates before intensity.`;
    }
    return `General: screen daily metrics; apply gates (BP, HRV, sleep, TIR, CRP). If no red flags, progress gradually. Stop for chest pain, severe dyspnea, dizziness, or near-fall.`;
  }

  // ---------- OPTIONAL AI ADDENDUM CALL ----------
  async function fetchCoachAddendum(payload){
    try {
      const res = await fetch('/api/coach', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if (!res.ok) return null;
      const data = await res.json();
      const add = (data && typeof data.addendum==='string') ? data.addendum.trim() : '';
      return add || null;
    } catch { return null; }
  }

  function currentMetricsForApi(){
    const m = lastSavedMetrics() || readFormMetrics(false) || {};
    return {
      hrvDeltaPct: m.hrvDeltaPct, sleepEff: m.sleepEff, sbp: m.sbp, dbp: m.dbp, tir: m.tir, crp: m.crp
    };
  }

  function lastSavedMetrics(){
    return state.metrics.length ? state.metrics[state.metrics.length-1] : null;
  }

  // ---------- EVENTS ----------
  els.genPlan.addEventListener('click', renderPlan);
  els.saveMetrics.addEventListener('click', ()=>{
    const m = readFormMetrics(true);
    if (!m) return;
    state.metrics.push(m); saveMetrics();
    drawChart();          // ensure line chart appears immediately
    renderPlan();         // refresh plan with saved metrics
    alert('Saved today’s metrics.');
  });
  els.clearForm.addEventListener('click', ()=>{
    ['hrvBaseline','hrvToday','sleepEff','sbp','dbp','tir','crp','notes'].forEach(id=>{ const el=$('#'+id); if (el) el.value=''; });
  });

  els.applyFinder.addEventListener('click', renderLibrary);
  els.clearFinder.addEventListener('click', ()=>{
    els.goalFilters.querySelectorAll('input:checked').forEach(i=>i.checked=false);
    els.libTypeFilters.querySelectorAll('input:checked').forEach(i=>i.checked=false);
    els.equipFilters.querySelectorAll('input:checked').forEach(i=>i.checked=false);
    document.querySelector('input[name=timeAvail][value="30"]').checked = true;
    document.querySelector('input[name=libFocus][value="both"]').checked = true;
    renderLibrary();
  });

  // Data (admin)
  els.reloadCsv?.addEventListener('click', ()=> loadCsvFromPath('data/master.csv'));
  els.fileCsv?.addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if (!f) return;
    Papa.parse(f,{header:true,dynamicTyping:true,skipEmptyLines:true,complete:(res)=>{
      state.rows = res.data.map(normalizeRow).filter(Boolean);
      rebuildTypeFilters(state.rows);
      renderLibrary();
      previewCsv(state.rows);
      alert('Loaded local CSV (not saved).');
    }});
  });

  els.exportBtn.addEventListener('click', ()=>{
    if (!state.metrics.length){ alert('No saved metrics.'); return; }
    const headers = ['date','hrvBaseline','hrvToday','hrvDeltaPct','sleepEff','sbp','dbp','tir','crp','notes'];
    const csv = [headers.join(',')].concat(state.metrics.map(m=>headers.map(h=>csvSafe(m[h])).join(','))).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'bhe_metrics.csv'; a.click();
    URL.revokeObjectURL(a.href);
  });

  els.clearBtn.addEventListener('click', ()=>{
    if (!confirm('Delete all saved metrics from this browser?')) return;
    state.metrics = []; saveMetrics(); drawChart();
  });

  // ---------- INIT ----------
  loadMetrics();
  loadCsvFromPath('data/master.csv');
  renderLibrary();
  drawChart();
  renderPlan();

  // ---------- UTILS ----------
  function toNum(v){ const n = Number(v); return isFinite(n) ? n : NaN; }
  function round1(x){ return Math.round(x*10)/10; }
  function fmtPct(x){ return isFinite(x) ? `${x.toFixed(1)}%` : '—'; }
  function escapeHtml(s){ return (s??'').toString().replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function csvSafe(v){ return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v); }
})();
