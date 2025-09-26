/* Brain Exercise App — stable tabs + clean AI fallback + sensible HRV delta
   - Tabs always toggle (CSS + JS)
   - AI addendum is shown ONLY if available (no "unavailable" message)
   - HRV Δ% is shown only when meaningful (|Δ| >= 0.1%)
   - Uses only real columns from master.csv; never invents categories
   - Parses CSV without Web Workers to avoid CSP-related hangs
*/
(function () {
  "use strict";

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const toNum = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g,"")); return Number.isFinite(n)? n : null; };

  const LKEY = "bp_exercise_entries_v7";
  const state = { csv: { headers: [], rows: [] }, chart: null };

  // ---------- Boot ----------
  on(window, "DOMContentLoaded", () => {
    bindTabs();
    // load CSV first (no worker to avoid CSP issues)
    loadCSV("data/master.csv")
      .then(({headers, rows}) => { state.csv = { headers, rows }; })
      .catch((err) => { showError("CSV load/parse issue: " + err.message); })
      .finally(() => {
        // App is usable even if CSV failed (no hallucination—CSV features just show nothing)
        bindPlan(); bindAsk(); renderLibrary(); renderHistory(); initChart(); renderDiagnostics();
      });
  });

  // ---------- Tabs ----------
  function bindTabs(){
    $$(".tab").forEach(btn=>{
      on(btn,"click",()=>{
        const name = btn.dataset.tab;
        $$(".tab").forEach(t=>t.classList.toggle("active", t===btn));
        $$(".tabpanel").forEach(p=>p.classList.toggle("active", p.id === `tab-${name}`));
      });
    });
  }

  // ---------- CSV (no Worker, no hang) ----------
  async function loadCSV(url){
    if (!window.Papa) throw new Error("CSV engine missing");
    const r1 = await tryParse(url);
    if (r1) return r1;
    const bust = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now();
    const r2 = await tryParse(bust);
    if (r2) return r2;
    throw new Error("Could not parse CSV (check header row and commas)");
  }

  async function tryParse(url){
    try{
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) return null;
      const text = await resp.text();
      const res = Papa.parse(text, { header: true, skipEmptyLines: true, worker: false });
      const rows = Array.isArray(res?.data) ? res.data : [];
      const headers = res?.meta?.fields || Object.keys(rows[0] || {});
      if (!headers.length || !rows.length) return null;
      return { headers, rows };
    }catch{ return null; }
  }

  // ---------- Error banner ----------
  function showError(msg){ const b = $("#error-banner"); if (b){ b.hidden = false; b.textContent = msg; } }

  // ---------- Helpers ----------
  function colAnyOf(...cand){
    for (const c of cand){
      const h = state.csv.headers.find(x => (x||"").toLowerCase() === c.toLowerCase());
      if (h) return h;
    }
    return null;
  }
  function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function n(v){ return v==null? "": String(v); }

  // ---------- Plan ----------
  function bindPlan(){
    on($("#plan-form"), "submit", (e)=> e.preventDefault());
    on($("#btn-generate"), "click", generatePlan);
    on($("#btn-clear"),    "click", clearPlanForm);
    on($("#btn-save"),     "click", saveToday);
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

    // Show HRV Δ% only when meaningful (abs change >= 0.1%)
    if (v.deltaPct != null && Math.abs(v.deltaPct) >= 0.1){
      lines.push(`• HRV Δ%: ${v.deltaPct.toFixed(1)}% (${v.hrvToday ?? "?"} vs ${v.hrvBaseline ?? "?"} ms)`);
      if (v.deltaPct < -10) lines.push("  → Lower intensity/volume; joint-friendly emphasis.");
      else if (v.deltaPct > 5) lines.push("  → You can emphasize performance or volume.");
    }

    if (v.sleepEff != null){ lines.push(`• Sleep efficiency: ${v.sleepEff}%`); if (v.sleepEff < 80) lines.push("  → Keep today sub-maximal; extend warm-up."); }
    if (v.sbp != null && v.dbp != null){ lines.push(`• BP: ${v.sbp}/${v.dbp} mmHg`); if (v.sbp>=160 || v.dbp>=90) lines.push("  → Avoid Valsalva; longer rest; stop if symptomatic."); }
    if (v.tir != null){ lines.push(`• CGM TIR 70–180: ${v.tir}%`); if (v.tir < 70) lines.push("  → Prefer steady, low-to-moderate intensity."); }
    if (v.crp != null){ lines.push(`• hs-CRP: ${v.crp} mg/L`); if (v.crp >= 3) lines.push("  → Favor recovery; cap intensity and volume."); }

    // CSV-derived suggestions (only real columns; nothing invented)
    const rows = state.csv.rows || [];
    const titleCol = colAnyOf("Exercise Type","title","name","protocol","exercise");
    const coachCol = colAnyOf("coach_script_non_api","coach_script","coach_notes");
    const typeCol  = colAnyOf("type","category","modality");
    const muscleCol = colAnyOf("Muscle Mass/Gain Muscle","muscle_mass","muscle");

    const aerobicMatch = (r) => {
      const t = (typeCol ? String(r[typeCol]) : "").toLowerCase();
      return /\baerobic|cardio|endurance|zone|walk|bike|row|run\b/.test(t);
    };

    const picks = [];
    for (const r of rows){
      if ((v.focus === "muscle" || v.focus === "both") && muscleCol && String(r[muscleCol]).trim() === "1") picks.push(r);
      if ((v.focus === "aerobic" || v.focus === "both") && typeCol && aerobicMatch(r)) picks.push(r);
    }
    const uniq = Array.from(new Set(picks));
    lines.push("", "Suggested protocols from CSV:");
    if (!uniq.length){ lines.push("• No focus-matched items found in CSV."); }
    else {
      uniq.slice(0,6).forEach(r=>{
        const t = titleCol ? String(r[titleCol]) : "(untitled)";
        lines.push(`• ${t}`);
        if (coachCol && r[coachCol]) lines.push(`   – ${String(r[coachCol])}`);
      });
    }

    // Do NOT print “AI unavailable”. Only add an addendum when we have it.
    o.textContent = lines.join("\n");

    try{
      fetch("/api/coach",{
        method:"POST",
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({mode:"plan_addendum", metrics:v, focus:v.focus})
      })
      .then(r=> r.ok? r.json() : Promise.reject())
      .then(j=>{
        if (j && j.text){
          o.textContent = o.textContent + "\n\n— AI Addendum —\n" + j.text;
        }
      })
      .catch(()=>{}); // silent if unavailable
    }catch{}
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

  // ---------- Library ----------
  function renderLibrary(){
    const grid = $("#library-grid"); const filters = $("#library-filters");
    if (!grid || !filters) return;
    grid.innerHTML = ""; filters.innerHTML = "";

    const rows = state.csv.rows || [];
    if (!rows.length){ grid.innerHTML = `<div class="muted">No CSV rows found.</div>`; return; }

    const titleCol = colAnyOf("Exercise Type","title","name","protocol","exercise");
    const typeCol  = colAnyOf("type","category","modality");
    const coachCol = colAnyOf("coach_script_non_api","coach_script","coach_notes");

    if (typeCol){
      const vals = Array.from(new Set(rows.map(r=> String(r[typeCol]).trim()).filter(Boolean))).sort();
      vals.slice(0,12).forEach(val=>{
        const chip = document.createElement("button");
        chip.className = "filter-chip"; chip.textContent = val; chip.dataset.val = val;
        chip.onclick = () => { $$(".filter-chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); draw(val); };
        filters.appendChild(chip);
      });
      $("#btn-clear-filters")?.addEventListener("click", () => { $$(".filter-chip").forEach(c=>c.classList.remove("active")); draw(null); });
    }

    function draw(activeVal){
      grid.innerHTML = "";
      const list = !activeVal? rows : rows.filter(r=> String(r[typeCol]).trim() === activeVal);
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

  // ---------- Ask (no noisy fallback) ----------
  function bindAsk(){
    const btn = $("#ask-btn");
    on(btn,"click", ()=>{
      const out = $("#ask-output"); const inp = $("#ask-input"); if (!out) return;
      const q = String(inp?.value || "").trim();
      const lines = [];

      try {
        const titleCol = colAnyOf("Exercise Type","title","name","protocol","exercise");
        const coachCol = colAnyOf("coach_script_non_api","coach_script","coach_notes");
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

      out.textContent = lines.join("\n");

      try{
        fetch("/api/coach",{
          method:"POST",headers:{'Content-Type':'application/json'},
          body:JSON.stringify({mode:"ask_addendum", query:q})
        })
        .then(r=> r.ok? r.json(): Promise.reject())
        .then(j=>{
          if (j && j.text){
            out.textContent = out.textContent + "\n\n— AI Addendum —\n" + j.text;
          }
        })
        .catch(()=>{});
      }catch{}
    });
  }

  // ---------- Progress ----------
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

  function initChart(){
    const ctx = $("#hrvChart"); if (!ctx || !window.Chart) return;
    state.chart = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [{ label:"HRV Δ% (saved)", data: [] }] },
      options: { responsive:true, maintainAspectRatio:false, scales:{y:{ticks:{callback:v=>v+"%"}}}, elements:{point:{radius:3}} }
    });
    updateChart();
  }
  function updateChart(){
    if (!state.chart) return;
    const entries = getEntries().sort((a,b)=>a.ts-b.ts);
    state.chart.data.labels = entries.map(e=> new Date(e.ts).toLocaleString());
    state.chart.data.datasets[0].data = entries.map(e=> e.deltaPct!=null ? Number(e.deltaPct.toFixed(1)) : null);
    state.chart.update();
  }

  // ---------- Diagnostics ----------
  function renderDiagnostics(){
    const host = $("#csv-diagnostics"); if (!host) return;
    const { headers, rows } = state.csv;
    const sample = rows.slice(0, 3);
    host.innerHTML = `
      <div><strong>Detected columns (${headers.length}):</strong> ${headers.join(", ")}</div>
      <div style="margin-top:8px" class="muted">First ${sample.length} rows (truncated):</div>
      <pre>${escapeHtml(JSON.stringify(sample, null, 2))}</pre>
    `;
  }
})();
