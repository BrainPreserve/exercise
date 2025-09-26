/* Brain Exercise App — Emergency Recovery Build
   Goal: Make the UI unbreakable. Tabs always work. Generate/Save always work.
   CSV/Chart load are optional; failures show a banner but never freeze the UI.
*/
(function () {
  "use strict";

  // ---------- tiny utils ----------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const toNum = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g,"")); return Number.isFinite(n)? n : null; };
  const showError = (msg) => { const b = $("#error-banner"); if (b){ b.textContent = msg; b.hidden = false; } };
  const safe = (fn) => (...args) => { try { return fn(...args); } catch(e){ console.error(e); showError("A component failed; the UI continues in safe mode."); } };

  const LKEY = "bp_exercise_entries_v3"; // v3 keeps multiple daily saves

  const state = { csv: { headers: [], rows: [] }, chart: null };

  // Always bind after DOM ready; guard every step
  on(window, "DOMContentLoaded", safe(() => {
    bindTabs();
    bindPlan();
    bindAsk();
    tryLoadCSV();     // best-effort
    tryInitChart();   // best-effort
    renderHistory();  // table view from localStorage
  }));

  // ---------- tabs (cannot fail) ----------
  function bindTabs(){
    $$(".tab").forEach(btn=>{
      on(btn,"click",()=> {
        const name = btn.dataset.tab;
        $$(".tab").forEach(t=>t.classList.toggle("active", t===btn));
        $$(".tabpanel").forEach(p=>p.classList.toggle("active", p.id === `tab-${name}`));
      });
    });
  }

  // ---------- plan ----------
  function bindPlan(){
    const form = $("#plan-form");
    const gen  = $("#btn-generate");
    const clr  = $("#btn-clear");
    const sav  = $("#btn-save");

    on(form, "submit", (e)=> e.preventDefault()); // never auto-clear
    on(gen,  "click", safe(generatePlan));
    on(clr,  "click", safe(clearPlanForm));
    on(sav,  "click", safe(saveToday)));
  }

  function getPlanInputs(){
    const focus = ($$('input[name="focus"]:checked')[0]?.value) || "muscle";
    const hrvBaseline = toNum($("#hrvBaseline")?.value);
    const hrvToday    = toNum($("#hrvToday")?.value);
    const deltaPct = (hrvBaseline && hrvToday) ? ((hrvToday - hrvBaseline)/hrvBaseline)*100 : null;
    return {
      focus,
      hrvBaseline, hrvToday, deltaPct,
      sleepEff: toNum($("#sleepEff")?.value),
      sbp: toNum($("#sbp")?.value),
      dbp: toNum($("#dbp")?.value),
      tir: toNum($("#tir")?.value),
      crp: toNum($("#crp")?.value),
    };
  }

  function generatePlan(){
    const o = $("#plan-output"); if (!o) return;
    const v = getPlanInputs();
    const lines = [];

    lines.push(`• Focus: ${v.focus.toUpperCase()}`);
    if (v.deltaPct != null){
      lines.push(`• HRV Δ%: ${v.deltaPct.toFixed(1)}% (${v.hrvToday ?? "?"} vs ${v.hrvBaseline ?? "?"} ms)`);
      if (v.deltaPct < -10) lines.push("  → Lower intensity/volume; joint-friendly emphasis.");
      else if (v.deltaPct > 5) lines.push("  → You can emphasize performance or volume.");
    }
    if (v.sleepEff != null){ lines.push(`• Sleep efficiency: ${v.sleepEff}%`); if (v.sleepEff < 80) lines.push("  → Keep today sub-maximal; extend warm-up."); }
    if (v.sbp != null && v.dbp != null){ lines.push(`• BP: ${v.sbp}/${v.dbp} mmHg`); if (v.sbp>=140 || v.dbp>=90) lines.push("  → Avoid Valsalva; longer rest; stop if symptomatic."); }
    if (v.tir != null){ lines.push(`• CGM TIR 70–180: ${v.tir}%`); if (v.tir < 70) lines.push("  → Prefer steady, low-to-moderate intensity."); }
    if (v.crp != null){ lines.push(`• hs-CRP: ${v.crp} mg/L`); if (v.crp >= 3) lines.push("  → Favor recovery; cap intensity and volume."); }

    // Best-effort CSV suggestions (never required for the UI to work)
    try {
      const titleCol = pickCol(["title","name","protocol","exercise"]);
      const coachCol = pickCol(["coach_script_non_api","coach_script","coach_notes"]);
      const typeCol  = pickCol(["type","category"]);
      if (state.csv.rows.length && (titleCol || typeCol || coachCol)){
        lines.push("", "Suggested protocols from CSV:");
        const aerobicMatch = (r) => {
          const t = (typeCol ? String(r[typeCol]) : "").toLowerCase();
          return /\baerobic|cardio|endurance|zone|walk|bike|row|run\b/.test(t);
        };
        const muscleCol = state.csv.headers.find(h => /muscle/.test((h||"").toLowerCase()));
        const picks = [];
        for(const r of state.csv.rows){
          if (v.focus === "muscle" || v.focus === "both"){ if (muscleCol && String(r[muscleCol]).trim()==="1") picks.push(r); }
          if (v.focus === "aerobic" || v.focus === "both"){ if (typeCol && aerobicMatch(r)) picks.push(r); }
        }
        if (!picks.length) lines.push("• No focus-matched items in CSV.");
        for (const r of picks.slice(0,6)){
          const t = titleCol ? String(r[titleCol]) : "(untitled)";
          lines.push(`• ${t}`);
          if (coachCol && r[coachCol]) lines.push(`   – ${String(r[coachCol])}`);
        }
      }
    } catch(e){ console.warn("CSV suggestion step skipped:", e); }

    // AI addendum — optional, never blocks UI
    lines.push("", "— AI Addendum —");
    o.textContent = lines.join("\n");
    try {
      fetch("/api/coach",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:"plan_addendum", metrics:v, focus:v.focus})})
        .then(r=> r.ok ? r.json() : Promise.reject(r.statusText))
        .then(j=>{ if (j && j.text) o.textContent = o.textContent + "\n" + j.text; })
        .catch(()=>{ o.textContent = o.textContent + "\n(AI addendum unavailable; deterministic plan shown.)"; });
    } catch { /* ignore */ }
  }

  function clearPlanForm(){
    ["hrvBaseline","hrvToday","sleepEff","sbp","dbp","tir","crp"].forEach(id=>{ const el = $("#"+id); if (el) el.value=""; });
    const o = $("#plan-output"); if (o) o.textContent = "";
  }

  function saveToday(){
    const v = getPlanInputs();
    const entry = { ts: Date.now(), date: new Date().toISOString().slice(0,10), ...v };
    const arr = getEntries(); arr.push(entry);
    localStorage.setItem(LKEY, JSON.stringify(arr));
    renderHistory(); updateChart();
  }

  function getEntries(){
    try { const raw = localStorage.getItem(LKEY); const arr = raw? JSON.parse(raw): []; return Array.isArray(arr)? arr: []; }
    catch { return []; }
  }

  // ---------- library (safe no-ops if CSV missing) ----------
  function renderLibrary(){
    const grid = $("#library-grid"); const filters = $("#library-filters");
    if (!grid || !filters) return;
    grid.innerHTML = ""; filters.innerHTML = "";

    if (!state.csv.rows.length){ grid.innerHTML = `<div class="muted">CSV not loaded yet.</div>`; return; }

    const titleCol = pickCol(["title","name","protocol","exercise"]);
    const typeCol  = pickCol(["type","category"]);
    const coachCol = pickCol(["coach_script_non_api","coach_script","coach_notes"]);

    // chips
    if (typeCol){
      const vals = Array.from(new Set(state.csv.rows.map(r=> String(r[typeCol]).trim()).filter(Boolean))).sort();
      vals.slice(0,12).forEach(val=>{
        const chip = document.createElement("button");
        chip.className = "filter-chip"; chip.textContent = val; chip.dataset.val = val;
        chip.onclick = () => { $$(".filter-chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); draw(val); };
        filters.appendChild(chip);
      });
      const clearBtn = $("#btn-clear-filters"); if (clearBtn){ clearBtn.onclick = () => { $$(".filter-chip").forEach(c=>c.classList.remove("active")); draw(null); }; }
    }

    function draw(activeVal){
      grid.innerHTML = "";
      const list = !activeVal? state.csv.rows : state.csv.rows.filter(r=> String(r[typeCol]).trim() === activeVal);
      if (!list.length){ grid.innerHTML = `<div class="muted">No protocols to display.</div>`; return; }
      for (const r of list){
        const card = document.createElement("div"); card.className = "protocol";
        const title = titleCol ? String(r[titleCol]) : "(untitled)";
        const type  = typeCol ? ` <span class="muted">(${r[typeCol]})</span>` : "";
        const coach = coachCol? String(r[coachCol]||"") : "";
        card.innerHTML = `<h3>${escapeHtml(title)}${type}</h3>${coach? `<div class="muted">${escapeHtml(coach)}</div>`:""}`;
        grid.appendChild(card);
      }
    }
    draw(null);
  }

  // ---------- ask (works without CSV) ----------
  function bindAsk(){
    const btn = $("#ask-btn");
    on(btn,"click", safe(()=> {
      const out = $("#ask-output"); const inp = $("#ask-input");
      if (!out) return;
      const q = String(inp?.value || "").trim();
      const lines = [];
      // Deterministic suggestions from CSV if available
      try {
        const titleCol = pickCol(["title","name","protocol","exercise"]);
        const coachCol = pickCol(["coach_script_non_api","coach_script","coach_notes"]);
        const rows = state.csv.rows || [];
        const matches = q ? rows.filter(r=>{
          const hay = ((titleCol? String(r[titleCol]).toLowerCase()+" ":"") + (coachCol? String(r[coachCol]).toLowerCase():""));
          return hay.includes(q.toLowerCase());
        }) : rows.slice(0,5);
        lines.push("Deterministic suggestions (from CSV):");
        if (!matches.length) lines.push("• No CSV suggestions.");
        matches.slice(0,6).forEach(r=>{
          const t = titleCol? String(r[titleCol]) : "(untitled)";
          lines.push(`• ${t}`); if (coachCol && r[coachCol]) lines.push(`   – ${String(r[coachCol])}`);
        });
      } catch { lines.push("Deterministic suggestions unavailable."); }
      lines.push("", "— AI Addendum —");
      out.textContent = lines.join("\n");
      // AI addendum (best-effort)
      try{
        fetch("/api/coach",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:"ask_addendum", query:q})})
          .then(r=> r.ok? r.json(): Promise.reject(r.statusText))
          .then(j=>{ if (j && j.text) out.textContent = out.textContent + "\n" + j.text; })
          .catch(()=>{ out.textContent = out.textContent + "\n(AI addendum unavailable.)"; });
      }catch{}
    }));
  }

  // ---------- progress (table + optional chart) ----------
  function renderHistory(){
    const host = $("#history-table"); if (!host) return;
    const entries = getEntries().sort((a,b)=>a.ts-b.ts);
    if (!entries.length){ host.innerHTML = `<div class="muted">No saved entries yet.</div>`; return; }
    const rows = entries.map(e=>`<tr>
      <td>${new Date(e.ts).toLocaleString()}</td>
      <td>${n(e.hrvBaseline)}</td><td>${n(e.hrvToday)}</td>
      <td>${e.deltaPct!=null? e.deltaPct.toFixed(1)+'%':''}</td>
      <td>${n(e.sleepEff)}</td><td>${n(e.sbp)}/${n(e.dbp)}</td>
      <td>${n(e.tir)}</td><td>${n(e.crp)}</td><td>${e.focus}</td>
    </tr>`).join("");
    host.innerHTML = `<table>
      <thead><tr>
        <th>Saved at</th><th>HRV base</th><th>HRV</th><th>HRV Δ%</th>
        <th>Sleep %</th><th>BP</th><th>TIR %</th><th>CRP</th><th>Focus</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function tryInitChart(){
    try {
      const ctx = $("#hrvChart"); if (!ctx || !window.Chart) return;
      state.chart = new Chart(ctx, {
        type: "line",
        data: { labels: [], datasets: [{ label:"HRV Δ% (saved)", data: [] }] },
        options: { responsive:true, maintainAspectRatio:false, scales:{y:{ticks:{callback:v=>v+"%"}}}, elements:{point:{radius:3}} }
      });
      updateChart();
    } catch(e){ console.warn("Chart disabled:", e); }
  }

  function updateChart(){
    if (!state.chart) return;
    const entries = getEntries().sort((a,b)=>a.ts-b.ts);
    state.chart.data.labels = entries.map(e=> new Date(e.ts).toLocaleString());
    state.chart.data.datasets[0].data = entries.map(e=> e.deltaPct!=null ? Number(e.deltaPct.toFixed(1)) : null);
    state.chart.update();
  }

  // ---------- CSV (best-effort) ----------
  function tryLoadCSV(){
    try {
      if (!window.Papa){ showError("CSV engine not ready; continuing without Library."); return; }
      Papa.parse("data/master.csv", {
        download:true, header:true, skipEmptyLines:true,
        complete: (res)=>{
          if (!res || !Array.isArray(res.data)){ showError("Could not parse master.csv"); return; }
          const rows = res.data; const headers = res.meta?.fields || Object.keys(rows[0]||{});
          state.csv = { headers, rows };
          renderDiagnostics(); renderLibrary();
        },
        error: ()=> showError("Failed to load master.csv")
      });
    } catch(e){ console.warn("CSV load skipped:", e); }
  }

  // ---------- helpers ----------
  function pickCol(cands){ for (const c of cands){ const h = state.csv.headers.find(x => (x||"").toLowerCase() === c.toLowerCase()); if (h) return h; } return null; }
  function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function n(v){ return v==null? "": String(v); }
})();
