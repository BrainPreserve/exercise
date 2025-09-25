// Netlify Function: /api/coach
// Reads OPENAI_API_KEY (and optional OPENAI_MODEL) from Netlify env vars.
// Returns a short "AI Coach Addendum" that may NOT contradict safety gates.
// Designed for minimal PII: accepts only metrics/gates/baseline/protocol title+modality or an Ask query.

export default async function handler(event) {
  // CORS (same-origin in production; allow any for simplicity)
  if (event.httpMethod === 'OPTIONS') {
    return cors(200, '');
  }
  if (event.httpMethod !== 'POST') {
    return cors(405, JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return cors(200, JSON.stringify({ addendum: '' })); // graceful empty when not configured
    }

    const body = JSON.parse(event.body || '{}');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const userPayload = sanitize(body);

    const system = [
      'You are a cautious exercise coach for older adults focused on cognition.',
      'Never contradict or override the following safety gates: bpHigh, hrvLow, sleepLow, tirLow, crpHigh.',
      'If any gate is active, your addendum must align with it.',
      'Keep addendum brief (<= 120 words), actionable, and specific.',
      'No medical diagnoses; educational coaching only.'
    ].join(' ');

    const prompt = buildPrompt(userPayload);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!resp.ok) {
      return cors(200, JSON.stringify({ addendum: '' })); // silent fallback
    }

    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').toString().trim();
    const addendum = stripJSONWrappers(text).slice(0, 1200); // clamp length

    return cors(200, JSON.stringify({ addendum }));
  } catch (e) {
    return cors(200, JSON.stringify({ addendum: '' })); // silent fallback on error
  }
}

// ---------- helpers ----------
function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body
  };
}

function sanitize(p = {}) {
  // remove any unexpected fields
  const out = {
    kind: p.kind || '',
    baseline: (p.baseline || '').toString().slice(0, 2000),
    gates: Object.assign({ bpHigh:false, hrvLow:false, sleepLow:false, tirLow:false, crpHigh:false }, p.gates || {}),
    metrics: minimal(p.metrics),
  };
  if (p.kind === 'protocol') {
    out.protocol = {
      title: (p.protocol?.title || '').toString().slice(0, 120),
      modality: (p.protocol?.modality || '').toString().slice(0, 160),
    };
  }
  if (p.kind === 'ask') {
    out.query = (p.query || '').toString().slice(0, 500);
  }
  return out;
}

function minimal(m = {}) {
  return {
    hrvDeltaPct: num(m.hrvDeltaPct),
    sleepEff: num(m.sleepEff),
    sbp: num(m.sbp),
    dbp: num(m.dbp),
    tir: num(m.tir),
    crp: num(m.crp)
  };
}

function num(x){ const n = Number(x); return isFinite(n) ? n : null; }

function buildPrompt(p){
  const gateTxt = Object.entries(p.gates||{}).filter(([,v])=>!!v).map(([k])=>k).join(', ') || 'none';
  const metrics = JSON.stringify(p.metrics || {});
  if (p.kind === 'protocol') {
    return [
      `CONTEXT: metrics=${metrics}; active_gates=${gateTxt}.`,
      `BASELINE (non-API, must not be contradicted): ${p.baseline}`,
      `PROTOCOL: title="${p.protocol?.title}", modality="${p.protocol?.modality}".`,
      `TASK: Provide a concise "AI Coach Addendum" (<= 120 words) that *complements* the baseline with rationale,`,
      `progression cues, or safety reminders consistent with gates. Avoid repeating the full baseline; add value.`,
    ].join(' ');
  }
  // ask
  return [
    `CONTEXT: metrics=${metrics}; active_gates=${gateTxt}.`,
    `USER QUESTION: ${p.query}`,
    `BASELINE ANSWER (non-API): ${p.baseline}`,
    `TASK: Provide a concise "AI Coach Addendum" (<= 120 words) that clarifies or extends the baseline without contradicting gates.`,
  ].join(' ');
}

function stripJSONWrappers(s){
  // If model returned something like {"addendum":"..."} extract the string; else return raw
  try {
    const j = JSON.parse(s);
    if (j && typeof j.addendum === 'string') return j.addendum;
  } catch(_){}
  return s;
}
