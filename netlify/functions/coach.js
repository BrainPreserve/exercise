// /.netlify/functions/coach — AI addendum generator
import fetch from 'node-fetch';
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const { question, latest, gates } = JSON.parse(event.body || '{}') || {};
    const gateLines = [];
    if (latest && gates){
      gateLines.push(`Metrics: HRV Δ ${latest.hrvDeltaPct}% ; Sleep ${latest.sleepEff}% ; SBP/DBP ${latest.sbp}/${latest.dbp} ; TIR ${latest.tir}% ; hs-CRP ${latest.crp} mg/L.`);
      if (!gates.hiAllowed) gateLines.push('Deterministic gate: avoid max/near-max intensity today; emphasize moderate, skill-focused work.');
      else gateLines.push('Deterministic gate: high-intensity permissible if technique is safe and client feels well.');
    }
    const sys = [
      'You are an exercise coach for older adults focused on cognition and safety.',
      'Never contradict the deterministic safety gate.',
      'Be concise (120–180 words), clinically neutral, and practical.'
    ].join(' ');
    const userParts = [];
    if (question) userParts.push(`User question: ${question}`);
    if (gateLines.length) userParts.push(gateLines.join(' '));
    const body = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userParts.join('\n\n') }
      ],
      temperature: 0.3
    };
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY||''}` },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return { statusCode: 200, body: JSON.stringify({ addendum: '' }) };
    const data = await resp.json();
    const addendum = data?.choices?.[0]?.message?.content || '';
    return { statusCode: 200, body: JSON.stringify({ addendum }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ addendum: '' }) };
  }
};
