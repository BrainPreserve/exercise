/* Brain Exercise App — CSV-first with automatic AI addenda
   This version:
   - Restores Type chips + adds a Search box in Library
   - Fuzzy Ask matching with synonyms & type fallback
   - Hides Data tab unless #admin or Shift+D pressed 3x
*/

(() => {
  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const byId = (id) => document.getElementById(id);
  const banner = byId("error-banner");
  const showError = (msg) => { banner.textContent = msg; banner.hidden = false; };
  const hideError = () => { banner.hidden = true; banner.textContent = ""; };
  const parseNum = (v) => {
    if (v == null) return null;
    const z = String(v).replace(/[^0-9.\-]/g, "");
    if (!z) return null;
    const n = Number(z);
    return Number.isFinite(n) ? n : null;
  };
  const todayKey = () => new Date().toISOString().slice(0,10);

  // ---------- Admin / Data tab gate ----------
  let secretPresses = 0;
  function maybeShowDataTab(reason) {
    const tab = byId("tab-data");
    if (!tab) return;
    if (reason === "hash" && location.hash === "#admin") tab.hidden = false;
    if (reason === "keypress") {
      secretPresses++;
      if (secretPresses >= 3) tab.hidden = false;
      setTimeout(() => secretPresses = 0, 1200);
    }
  }
  window.addEventListener("hashchange", () => maybeShowDataTab("hash"));
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "d" && e.shiftKey) maybeShowDataTab("keypress");
  });

  // ---------- Local storage ----------
  const store = {
    getHistory() { return JSON.parse(localStorage.getItem("bp_ex_hist") || "[]"); },
    setHistory(arr) { localStorage.setItem("bp_ex_hist", JSON.stringify(arr)); },
    append(record) { const all = store.getHistory(); all.push(record); store.setHistory(all); }
  };

  // ---------- CSV ----------
  const CSV_URL = "data/master.csv";
  let RAW = [], PROTOCOLS = [], GOAL_COLUMNS = [];
  function discoverGoals(headers) {
    const candidates = ["cv_fitness","body_composition","lipids","glycemic_control","blood_pressure","muscle_mass","goal_label"];
    return candidates.filter(h => headers.includes(h));
  }
  function normalizeRow(row) {
    const title = (row.title || row.name || row.protocol || "").trim();
    const typeRaw = (row.type || row.exercise_type || "").toLowerCase().trim();
    const type = typeRaw.includes("aero") ? "aerobic"
               : typeRaw.includes("cardio") ? "aerobic"
               : typeRaw.includes("muscle") ? "muscular"
               : typeRaw.includes("resistance") ? "muscular"
               : (typeRaw || "");
    const nonApi = (row.coach_script_non_api || row.deterministic || row.coach || "").trim();
    const goals = {};
    GOAL_COLUMNS.forEach(h => {
      const v = (row[h] ?? "").toString().trim().toLowerCase();
      goals[h] = h === "goal_label" ? v : (v === "1" || v === "true" || v === "yes" || v === "y");
    });
    return { title, type, nonApi, goals, raw: row };
  }
  function loadCSV() {
    return new Promise((resolve, reject) => {
      Papa.parse(CSV_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: (res) => {
          try {
            const rows = res.data || [];
            const headers = res.meta?.fields || [];
            RAW = rows;
            GOAL_COLUMNS = discoverGoals(headers);
            PROTOCOLS = rows.map(normalizeRow).filter(p => p.title);
            renderDiagnostics(headers);
            renderLibraryFilters();
            renderLibrary(PROTOCOLS);
            resolve();
          } catch (e) { reject(e); }
        },
        error: (err) => reject(err)
      });
    });
  }

  // ---------- Tabs ----------
  function initTabs() {
    const tabs = $$(".tab");
    const panels = $$(".tabpanel");
    tabs.forEach(btn => {
      btn.addEventListener("click", () => {
        tabs.forEach(b => b.classList.remove("active"));
        panels.forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        byId(`tab-${btn.dataset.tab}`).classList.add("active");
      });
    });
    // if #admin at load, reveal Data
    maybeShowDataTab("hash");
  }

  // ---------- PLAN ----------
  function hrvDeltaPct(baseline, today) {
    if (baseline == null || today == null || baseline <= 0) return null;
    return Math.round(((today - baseline) / baseline) * 100);
  }
  function planDeterministicText(inputs) {
    const { baseline, today, sleep, sbp, dbp, tir, crp, focus } = inputs;
    const delta = hrvDeltaPct(baseline, today);
    const red = [];
    if (delta !== null && delta <= -7) red.push(`HRV ↓ ${delta}% vs baseline`);
    if (sleep != null && sleep < 85) red.push(`sleep efficiency ${sleep}%`);
    if (sbp != null && dbp != null && (sbp >= 140 || dbp >= 90)) red.push(`elevated BP (${sbp}/${dbp})`);
    if (tir != null && tir < 70) red.push(`CGM TIR ${tir}% (<70%)`);
    if (crp != null && crp >= 3) red.push(`hs-CRP ${crp} mg/L`);
    const ease = red.length ? "Reduce intensity/volume; extend warm-up; prioritize technique and nasal breathing."
                            : "Proceed at planned load; quality over quantity.";
    const focusText = focus === "muscle" ? "Resistance / muscle-strength focus"
                    : focus === "aerobic" ? "Aerobic conditioning focus"
                    : "Concurrent: resistance + aerobic";
    const header = `• Focus: ${focusText}\n• Status: ${red.length ? "Caution — " + red.join("; ") : "Green"}`;
    const prescription =
      focus === "muscle"
        ? "Session: 4–6 exercises, 2–4 sets, RPE 6–7 (leave 2–3 reps in reserve). Finish with 5–10 min zone-2 cooldown."
        : focus === "aerobic"
        ? "Session: 30–45 min zone-2; optional 4–6 × 30–60 s strides at RPE 7 with full recovery if feeling fresh."
        : "Session: 25–30 min zone-2 + 2–3 compound lifts 2–3 sets each at RPE 6–7.";
    return `${header}\n\n${prescription}\n\nIf HRV low or sleep poor, Reduce intensity/volume; extend warm-up; prioritize technique and nasal breathing.`;
  }
  async function planAIAddendum(inputs, deterministicText) {
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode:"plan", metrics:inputs, deterministic:deterministicText })
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      return (data.text || data.answer || data.output || "").trim();
    } catch { return ""; }
  }
  function captureInputs() {
    const focus = ($$("input[name='focus']:checked")[0] || {}).value || "muscle";
    return {
      baseline: parseNum(byId("hrvBaseline").value),
      today: parseNum(byId("hrvToday").value),
      sleep: parseNum(byId("sleepEff").value),
      sbp: parseNum(byId("sbp").value),
      dbp: parseNum(byId("dbp").value),
      tir: parseNum(byId("tir").value),
      crp: parseNum(byId("crp").value),
      focus
    };
  }
  async function onGeneratePlan() {
    hideError();
    const inputs = captureInputs();
    const det = planDeterministicText(inputs);
    const ai = await planAIAddendum(inputs, det);
    byId("plan-output").innerText =
      `### Non-API (Deterministic)\n${det}\n\n### GPT-like API Addendum\n${ai || "(no API addendum available)"}`;
  }
  function onClearForm(){ ["hrvBaseline","hrvToday","sleepEff","sbp","dbp","tir","crp"].forEach(id=>byId(id).value=""); byId("plan-output").textContent=""; }
  function onSaveToday(){
    const i = captureInputs(); const d = hrvDeltaPct(i.baseline,i.today);
    const rec = {date: todayKey(), hrv_delta_pct: d, sleep:i.sleep, sbp:i.sbp, dbp:i.dbp, tir:i.tir, crp:i.crp, focus:i.focus};
    const all = JSON.parse(localStorage.getItem("bp_ex_hist")||"[]"); all.push(rec); localStorage.setItem("bp_ex_hist", JSON.stringify(all));
    renderHistory(); renderHRVChart();
  }
  function initPlan(){
    byId("btn-generate").onclick = onGeneratePlan;
    byId("btn-clear").onclick = onClearForm;
    byId("btn-save").onclick = onSaveToday;
  }

  // ---------- LIBRARY ----------
  function renderLibraryFilters() {
    const wrap = byId("library-filters"); wrap.innerHTML = "";
    // Type chips
    ["aerobic","muscular"].forEach(t=>{
      const b=document.createElement("button"); b.className="filter-chip"; b.dataset.type=t; b.textContent=t[0].toUpperCase()+t.slice(1);
      b.onclick=()=>{ b.classList.toggle("active"); applyLibraryFilters(); }; wrap.appendChild(b);
    });
    // Goal chips (only those present)
    GOAL_COLUMNS.forEach(h=>{
      const b=document.createElement("button"); b.className="filter-chip"; b.dataset.goal=h;
      b.textContent=h.replace(/_/g," ").replace(/\b\w/g,s=>s.toUpperCase());
      b.onclick=()=>{ b.classList.toggle("active"); applyLibraryFilters(); }; wrap.appendChild(b);
    });
    // Search
    const search = byId("library-search");
    search.oninput = () => applyLibraryFilters();
    byId("btn-clear-filters").onclick = () => {
      $$(".filter-chip", wrap).forEach(c=>c.classList.remove("active"));
      search.value=""; applyLibraryFilters();
    };
  }
  function applyLibraryFilters() {
    const activeTypes = $$(".filter-chip[data-type].active").map(c=>c.dataset.type);
    const activeGoals = $$(".filter-chip[data-goal].active").map(c=>c.dataset.goal);
    const q = (byId("library-search").value || "").toLowerCase();

    const filtered = PROTOCOLS.filter(p=>{
      const typeOk = !activeTypes.length || activeTypes.includes(p.type);
      const goalsOk = !activeGoals.length || activeGoals.every(g=>{
        if (g==="goal_label") return ((p.raw.goal_label||"")+"").trim().length>0;
        return !!p.goals[g];
      });
      const searchOk = !q || (p.title+" "+p.type+" "+(p.raw.goal_label||"")).toLowerCase().includes(q);
      return typeOk && goalsOk && searchOk;
    });
    renderLibrary(filtered);
  }
  async function buildAIAddendumForProtocol(p){
    try{
      const res = await fetch("/api/coach",{method:"POST",headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ mode:"protocol", protocol:{ title:p.title, type:p.type, goals:p.goals, raw:p.raw }})});
      if(!res.ok) throw new Error("API");
      const data = await res.json(); return (data.text||data.answer||"").trim();
    }catch{return "";}
  }
  function protocolCardHTML(p, aiText){
    const typeLabel = p.type ? ` (${p.type})` : "";
    const nonApi = p.nonApi || "Today: complete planned session at RPE 6–7. If HRV low or sleep poor, reduce intensity/volume.";
    const goalList = GOAL_COLUMNS
      .filter(h => h==="goal_label" ? (p.raw.goal_label||"") : p.goals[h])
      .map(h => h.replace(/_/g," ")).join(", ");
    return `<div class="protocol">
      <h3>${p.title}${typeLabel}</h3>
      ${goalList ? `<div class="muted" style="margin-bottom:8px">Goals: ${goalList}</div>` : ""}
      <div><strong>Non-API (Deterministic)</strong><br>${nonApi}</div>
      <div style="margin-top:8px"><strong>GPT-like API Addendum</strong><br>${aiText || "(no API addendum available)"}</div>
    </div>`;
  }
  async function renderLibrary(list){
    const grid=byId("library-grid"); grid.innerHTML="";
    const promises=list.map(async p=>{
      const shell=document.createElement("div"); shell.innerHTML=protocolCardHTML(p,""); grid.appendChild(shell.firstElementChild);
      const ai=await buildAIAddendumForProtocol(p);
      const last=grid.lastElementChild; if(last) last.outerHTML=protocolCardHTML(p,ai);
    });
    await Promise.allSettled(promises);
  }

  // ---------- ASK (fuzzy + synonyms + type fallback) ----------
  const SYN = new Map(Object.entries({
    walk:["walking","brisk"],
    hiit:["interval","sprint","repeat"],
    aerobic:["zone 2","cardio","endurance"],
    muscular:["resistance","strength","lifting","weights","hypertrophy"]
  }));
  function tokenize(s){ return (s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean); }
  function expandTerms(terms){
    const out=new Set(terms);
    for(const t of terms){ for(const [k,arr] of SYN.entries()){
      if (t===k || arr.includes(t)) { out.add(k); arr.forEach(x=>out.add(x)); }
    }}
    return [...out];
  }
  function fuzzyScore(q, p){
    const hay = (p.title+" "+p.type+" "+(p.raw.goal_label||"")).toLowerCase();
    let s=0; q.forEach(t=>{ if(hay.includes(t)) s+=1; });
    return s + (p.type && q.includes(p.type) ? 1 : 0);
  }
  async function onAsk(){
    hideError();
    const qraw = byId("ask-input").value.trim();
    if(!qraw){ byId("ask-output").textContent="Please enter a question."; return; }
    const terms = expandTerms(tokenize(qraw));
    let ranked = PROTOCOLS.map(p=>({p,score:fuzzyScore(terms,p)})).filter(x=>x.score>0)
                  .sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.p);
    // Fallback by type if nothing found
    if(!ranked.length){
      const hint = terms.find(t=>["aerobic","muscular"].includes(t));
      ranked = PROTOCOLS.filter(p=> hint ? p.type===hint : true).slice(0,3);
    }
    const detBlocks = ranked.map(p=>`• ${p.title}${p.type?` (${p.type})`:""}\n  ${(p.nonApi||"RPE 6–7; scale to HRV/sleep.")}`);
    // AI addendum
    let ai="";
    try{
      const res=await fetch("/api/coach",{method:"POST",headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ mode:"ask", question:qraw, context:ranked.map(p=>({title:p.title,type:p.type,raw:p.raw})) })});
      if(res.ok){ const data=await res.json(); ai=(data.text||data.answer||"").trim(); }
    }catch{}
    byId("ask-output").textContent =
      `Non-API (Deterministic)\n${detBlocks.length?detBlocks.join("\n\n"):"• No CSV suggestions."}\n\n`+
      `GPT-like API Addendum\n${ai || "(no API addendum available)"}`;
  }
  function initAsk(){ byId("ask-btn").onclick = onAsk; }

  // ---------- PROGRESS ----------
  let chart;
  function renderHistory(){
    const rows = store.getHistory().slice().reverse();
    const host = byId("history-table");
    if(!rows.length){ host.innerHTML="<p class='muted'>No saved days yet.</p>"; return; }
    const headers=["Date","HRV Δ%","Sleep %","SBP","DBP","TIR %","hs-CRP","Focus"];
    const html=["<table><thead><tr>",...headers.map(h=>`<th>${h}</th>`),"</tr></thead><tbody>",
      ...rows.map(r=>`<tr><td>${r.date}</td><td>${r.hrv_delta_pct ?? ""}</td><td>${r.sleep ?? ""}</td><td>${r.sbp ?? ""}</td><td>${r.dbp ?? ""}</td><td>${r.tir ?? ""}</td><td>${r.crp ?? ""}</td><td>${r.focus ?? ""}</td></tr>`),
      "</tbody></table>"].join("");
    host.innerHTML=html;
  }
  function renderHRVChart(){
    const rows=store.getHistory(); const labels=rows.map(r=>r.date); const data=rows.map(r=>r.hrv_delta_pct);
    const ctx=byId("hrvChart").getContext("2d"); if(chart) chart.destroy();
    chart = new Chart(ctx,{ type:"line", data:{ labels, datasets:[{ label:"HRV Δ% vs baseline", data }]},
      options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ ticks:{ callback:v=>v+"%" }}}}});
  }

  // ---------- DIAGNOSTICS ----------
  function renderDiagnostics(headers){
    const host=byId("csv-diagnostics");
    host.textContent = [
      `Rows: ${RAW.length}`,
      `Detected headers: ${headers.join(", ")}`,
      `Goal columns used: ${GOAL_COLUMNS.join(", ") || "(none)"}`
    ].join("\n");
  }

  // ---------- Boot ----------
  async function boot(){
    try{
      initTabs(); initPlan(); initAsk();
      renderHistory(); renderHRVChart();
      await loadCSV();
    }catch(e){ showError(`Load failed: ${e.message||e}`); }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
