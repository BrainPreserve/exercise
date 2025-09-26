/* Brain Exercise App — CSV-first with automatic AI addenda
   Folder layout preserved:
   - /assets/app.js (this file)
   - /assets/styles.css
   - /data/master.csv
   - /netlify/functions/coach.js  (reachable at /api/coach)
*/

(() => {
  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const byId = (id) => document.getElementById(id);
  const banner = byId("error-banner");
  const showError = (msg) => {
    banner.textContent = msg;
    banner.hidden = false;
  };
  const hideError = () => { banner.hidden = true; banner.textContent = ""; };

  const parseNum = (v) => {
    if (v === null || v === undefined) return null;
    const z = String(v).replace(/[^0-9.\-]/g, "");
    if (!z) return null;
    const n = Number(z);
    return Number.isFinite(n) ? n : null;
  };

  const todayKey = () => new Date().toISOString().slice(0,10);
  const store = {
    getHistory() { return JSON.parse(localStorage.getItem("bp_ex_hist") || "[]"); },
    setHistory(arr) { localStorage.setItem("bp_ex_hist", JSON.stringify(arr)); },
    append(record) {
      const all = store.getHistory();
      all.push(record); store.setHistory(all);
    }
  };

  // ---------- CSV load ----------
  const CSV_URL = "data/master.csv";
  let RAW = [];        // raw rows from CSV
  let PROTOCOLS = [];  // normalized rows
  let GOAL_COLUMNS = []; // discovered goals from CSV present headers

  function discoverGoals(headers) {
    // Only show filters for headers that actually exist.
    const candidates = [
      "cv_fitness","body_composition","lipids","glycemic_control",
      "blood_pressure","muscle_mass","goal_label"
    ];
    return candidates.filter(h => headers.includes(h));
  }

  function normalizeRow(row) {
    // Be conservative: do not invent fields; read what exists.
    // Common patterns supported: title/name, type/exercise_type, coach_script_non_api, goal fields.
    const title = (row.title || row.name || row.protocol || "").trim();
    const typeRaw = (row.type || row.exercise_type || "").toLowerCase().trim();
    const type = typeRaw.includes("aero") ? "aerobic"
               : typeRaw.includes("cardio") ? "aerobic"
               : typeRaw.includes("muscle") ? "muscular"
               : typeRaw.includes("resistance") ? "muscular"
               : typeRaw || ""; // leave as-is if unseen

    // Deterministic coaching text, if present in CSV.
    const nonApi = (row.coach_script_non_api || row.deterministic || row.coach || "").trim();

    // Build a lightweight goals object using only present columns.
    const goals = {};
    GOAL_COLUMNS.forEach(h => {
      const v = (row[h] ?? "").toString().trim().toLowerCase();
      goals[h] = v === "1" || v === "true" || v === "yes" || v === "y" || (h === "goal_label" && v);
    });

    return { title, type, nonApi, goals, raw: row };
  }

  function loadCSV() {
    return new Promise((resolve, reject) => {
      Papa.parse(CSV_URL, {
        download: true, header: true, dynamicTyping: false, skipEmptyLines: true,
        complete: (res) => {
          try {
            const rows = res.data || [];
            const headers = res.meta?.fields || [];
            RAW = rows;
            GOAL_COLUMNS = discoverGoals(headers);

            PROTOCOLS = rows
              .map(normalizeRow)
              .filter(p => p.title); // require a title

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
  }

  // ---------- PLAN ----------
  function hrvDeltaPct(baseline, today) {
    if (baseline == null || today == null || baseline <= 0) return null;
    return Math.round(((today - baseline) / baseline) * 100);
    // sign: negative = below baseline
  }

  function planDeterministicText(inputs) {
    const { baseline, today, sleep, sbp, dbp, tir, crp, focus } = inputs;
    const delta = hrvDeltaPct(baseline, today);
    const redFlags = [];

    if (delta !== null && delta <= -7) redFlags.push(`HRV ↓ ${delta}% vs baseline`);
    if (parseNum(sleep) !== null && sleep < 85) redFlags.push(`sleep efficiency ${sleep}%`);
    if (parseNum(sbp) !== null && parseNum(dbp) !== null && (sbp >= 140 || dbp >= 90)) redFlags.push(`elevated BP (${sbp}/${dbp})`);
    if (parseNum(tir) !== null && tir < 70) redFlags.push(`CGM TIR ${tir}% (<70% target)`);
    if (parseNum(crp) !== null && crp >= 3) redFlags.push(`hs-CRP ${crp} mg/L`);

    const ease = redFlags.length ? "Reduce intensity/volume; extend warm-up; prioritize technique and nasal breathing." :
                                   "Proceed at planned load; quality over quantity.";

    const focusText = focus === "muscle" ? "Resistance / muscle-strength focus"
                      : focus === "aerobic" ? "Aerobic conditioning focus"
                      : "Concurrent: resistance + aerobic";

    const header = `• Focus: ${focusText}\n• Status: ${redFlags.length ? "Caution" : "Green"}${redFlags.length ? " — " + redFlags.join("; ") : ""}`;

    const prescription =
      focus === "muscle"
        ? "Session: 4–6 exercises, 2–4 sets, RPE 6–7 (leave 2–3 reps in reserve). Finish with 5–10 min zone-2 cooldown."
        : focus === "aerobic"
        ? "Session: 30–45 min zone-2; optional 4–6 × 30–60 s strides at RPE 7 with full recovery if feeling fresh."
        : "Session: 25–30 min zone-2 + 2–3 compound lifts 2–3 sets each at RPE 6–7.";

    return `${header}\n\n${prescription}\n\nIf HRV low or sleep poor, ${ease}`;
  }

  async function planAIAddendum(inputs, deterministicText) {
    // Calls your Netlify function at /api/coach (coach.js in /netlify/functions/)
    // If the function is absent or fails, we fail gracefully.
    try {
      const body = {
        mode: "plan",
        metrics: inputs,
        deterministic: deterministicText
      };
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const text = (data && (data.text || data.answer || data.output)) || "";
      return text.trim();
    } catch {
      return ""; // silent fail; deterministic text still shows
    }
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

    const out = byId("plan-output");
    out.innerHTML =
      `### Non-API (Deterministic)\n${det}\n\n` +
      (ai ? `### GPT-like API Addendum\n${ai}` : `### GPT-like API Addendum\n(no API addendum available)`);

    out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function onClearForm() {
    ["hrvBaseline","hrvToday","sleepEff","sbp","dbp","tir","crp"].forEach(id => byId(id).value = "");
    byId("plan-output").textContent = "";
  }

  function onSaveToday() {
    const inputs = captureInputs();
    const delta = hrvDeltaPct(inputs.baseline, inputs.today);
    const record = {
      date: todayKey(),
      hrv_delta_pct: delta,
      sleep: inputs.sleep,
      sbp: inputs.sbp,
      dbp: inputs.dbp,
      tir: inputs.tir,
      crp: inputs.crp,
      focus: inputs.focus
    };
    store.append(record);
    renderHistory();
    renderHRVChart();
  }

  function initPlan() {
    byId("btn-generate").addEventListener("click", onGeneratePlan);
    byId("btn-clear").addEventListener("click", onClearForm);
    byId("btn-save").addEventListener("click", onSaveToday);
  }

  // ---------- LIBRARY ----------
  function renderLibraryFilters() {
    const wrap = byId("library-filters");
    wrap.innerHTML = "";

    // Type chips
    const types = ["aerobic","muscular"];
    types.forEach(t => {
      const chip = document.createElement("button");
      chip.className = "filter-chip"; chip.dataset.type = t;
      chip.textContent = t[0].toUpperCase() + t.slice(1);
      chip.addEventListener("click", () => { chip.classList.toggle("active"); applyLibraryFilters(); });
      wrap.appendChild(chip);
    });

    // Goal checkboxes – only for headers that truly exist
    GOAL_COLUMNS.forEach(h => {
      const chip = document.createElement("button");
      chip.className = "filter-chip"; chip.dataset.goal = h;
      chip.textContent = h.replace(/_/g," ").replace(/\b\w/g, s => s.toUpperCase());
      chip.addEventListener("click", () => { chip.classList.toggle("active"); applyLibraryFilters(); });
      wrap.appendChild(chip);
    });

    byId("btn-clear-filters").onclick = () => {
      $$(".filter-chip", wrap).forEach(c => c.classList.remove("active"));
      applyLibraryFilters();
    };
  }

  function applyLibraryFilters() {
    const activeTypes = $$(".filter-chip[data-type].active").map(c => c.dataset.type);
    const activeGoals = $$(".filter-chip[data-goal].active").map(c => c.dataset.goal);

    const filtered = PROTOCOLS.filter(p => {
      const typeOk = !activeTypes.length || activeTypes.includes(p.type);
      const goalsOk = !activeGoals.length || activeGoals.every(g => {
        // goal_label may be a string; others are boolean flags
        if (g === "goal_label") {
          const gl = (p.raw.goal_label || "").toString().toLowerCase();
          return gl.length > 0;
        }
        return !!p.goals[g];
      });
      return typeOk && goalsOk;
    });

    renderLibrary(filtered);
  }

  async function buildAIAddendumForProtocol(p) {
    try {
      const body = { mode: "protocol", protocol: { title: p.title, type: p.type, goals: p.goals, raw: p.raw } };
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      return (data.text || data.answer || "").trim();
    } catch {
      return "";
    }
  }

  function protocolCardHTML(p, aiText) {
    const typeLabel = p.type ? ` (${p.type})` : "";
    const nonApi = p.nonApi || `Today: complete planned session at RPE 6–7. If HRV low or sleep poor, reduce intensity/volume.`;
    const aiBlock = aiText ? aiText : "(no API addendum available)";

    return `
      <div class="protocol">
        <h3>${p.title}${typeLabel}</h3>
        <div class="muted" style="margin-bottom:8px">
          ${GOAL_COLUMNS.length ? "Goals: " + GOAL_COLUMNS.filter(h => (h==="goal_label" ? (p.raw.goal_label||"") : p.goals[h])).map(h => h.replace(/_/g," ")).join(", ") : ""}
        </div>
        <div><strong>Non-API (Deterministic)</strong><br>${nonApi}</div>
        <div style="margin-top:8px"><strong>GPT-like API Addendum</strong><br>${aiBlock}</div>
      </div>
    `;
  }

  async function renderLibrary(list) {
    const grid = byId("library-grid");
    grid.innerHTML = "";

    // Create cards and fetch AI addenda in parallel to satisfy “every coaching output includes both…”
    const promises = list.map(async (p) => {
      const card = document.createElement("div");
      card.innerHTML = protocolCardHTML(p, ""); // temp without AI
      grid.appendChild(card.firstElementChild);

      const ai = await buildAIAddendumForProtocol(p);
      // Replace last card’s HTML with AI included
      const last = grid.lastElementChild;
      if (last) last.outerHTML = protocolCardHTML(p, ai);
    });

    await Promise.allSettled(promises);
  }

  // ---------- ASK ----------
  function keywordScore(q, p) {
    const s = (p.title + " " + p.type + " " + (p.raw.goal_label || "")).toLowerCase();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.reduce((acc,t) => acc + (s.includes(t) ? 1 : 0), 0);
  }

  async function onAsk() {
    hideError();
    const q = byId("ask-input").value.trim();
    if (!q) { byId("ask-output").textContent = "Please enter a question."; return; }

    // Deterministic: pick top 3 protocol matches by keyword score (no guessing about columns).
    const ranked = PROTOCOLS
      .map(p => ({ p, score: keywordScore(q,p) }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0,3)
      .map(x => x.p);

    const detBlocks = ranked.map(p => {
      const nonApi = p.nonApi || `Suggested: ${p.title} (${p.type||"session"}), RPE 6–7; scale based on HRV/sleep.`;
      return `• ${p.title}${p.type ? " ("+p.type+")" : ""}\n  ${nonApi}`;
    });

    // AI addendum
    let ai = "";
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ask", question: q, context_count: ranked.length, context: ranked.map(p => ({title:p.title,type:p.type,raw:p.raw})) })
      });
      if (res.ok) { const data = await res.json(); ai = (data.text || data.answer || "").trim(); }
    } catch { /* ignore */ }

    byId("ask-output").textContent =
      `Non-API (Deterministic)\n${detBlocks.length ? detBlocks.join("\n\n") : "• No CSV suggestions."}\n\n` +
      `GPT-like API Addendum\n${ai || "(no API addendum available)"}`;
  }

  function initAsk() {
    byId("ask-btn").addEventListener("click", onAsk);
  }

  // ---------- PROGRESS ----------
  let chart; // ChartJS instance

  function renderHistory() {
    const rows = store.getHistory().slice().reverse();
    const host = byId("history-table");
    if (!rows.length) { host.innerHTML = "<p class='muted'>No saved days yet.</p>"; return; }

    const headers = ["Date","HRV Δ%","Sleep %","SBP","DBP","TIR %","hs-CRP","Focus"];
    const html = [
      "<table><thead><tr>",
      ...headers.map(h => `<th>${h}</th>`),
      "</tr></thead><tbody>",
      ...rows.map(r => `<tr>
        <td>${r.date}</td><td>${r.hrv_delta_pct ?? ""}</td>
        <td>${r.sleep ?? ""}</td><td>${r.sbp ?? ""}</td><td>${r.dbp ?? ""}</td>
        <td>${r.tir ?? ""}</td><td>${r.crp ?? ""}</td><td>${r.focus ?? ""}</td>
      </tr>`),
      "</tbody></table>"
    ].join("");
    host.innerHTML = html;
  }

  function renderHRVChart() {
    const rows = store.getHistory();
    const labels = rows.map(r => r.date);
    const data = rows.map(r => r.hrv_delta_pct);
    const ctx = byId("hrvChart").getContext("2d");
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ label: "HRV Δ% vs baseline", data }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => v + "%" }}}}
    });
  }

  // ---------- DATA / DIAGNOSTICS ----------
  function renderDiagnostics(headers) {
    const host = byId("csv-diagnostics");
    const lines = [
      `Rows: ${RAW.length}`,
      `Detected headers: ${headers.join(", ")}`,
      `Goal columns used: ${GOAL_COLUMNS.join(", ") || "(none found)"}`
    ];
    host.textContent = lines.join("\n");
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      initTabs();
      initPlan();
      initAsk();
      renderHistory();
      renderHRVChart();
      await loadCSV();
    } catch (e) {
      showError(`Load failed: ${e.message || e}`);
    }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
