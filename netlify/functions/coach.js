// Netlify Function: /api/coach  -> /.netlify/functions/coach
// Uses OPENAI_API_KEY from Netlify environment. Never exposes keys to the browser.
// Safety: AI addendum MUST NOT contradict deterministic gates received from the client.

import fetch from 'node-fetch';

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const { question, latest, gates } = JSON.parse(event.body || '{}') || {};

    // Compose strict system prompt with safety gates (no contradiction allowed)
    const gateLines = [];
    if (latest && gates) {
      gateLines.push(
        `Metrics: HRVΔ=${latest.hrvDeltaPct}% ; Sleep=${latest.sleepEff}% ; BP=${latest.sbp}/${latest.dbp} ; TIR=${latest.tir}% ; hs-CRP=${latest.crp} mg/L.`,
        `Deterministic gates: ${gates.hiAllowed ? 'HI allowed with caution' : 'HI NOT allowed today'}; ` +
        `Badges summary (human-readable): ${ (gates.badges||[]).map(b=>b.text).join(' | ') }`
      );
    } else {
      gateLines.push('No saved metrics provided. Provide general, conservative advice.');
    }

    const SYSTEM = [
      'You are a cautious exercise coach for older adults focused on brain health.',
      'You NEVER contradict the deterministic gates or red-flags above.',
      'If gates indicate HOLD or CAUTION for high intensity, you must not recommend HIIT, sprints, max-effort lifts, or breathless efforts.',
      'Prefer conservative, technique-first recommendations, warm-up and cool-down. Include monitoring suggestions when relevant.',
      'Keep the addendum concise (5–8 sentences). No medical diagnosis.'
    ].join(' ');

    const USER = [
      gateLines.join('\n'),
      '\nQuestion:', String(question||'').slice(0, 1000)
    ].join('\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 200, body: JSON.stringify({ addendum: '' }) };
    }

    // Completions (compatible with current OpenAI chat APIs)
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 280,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER }
        ]
      })
    });

    if (!resp.ok) {
      // Fail closed (no addendum) to preserve deterministic output.
      return { statusCode: 200, body: JSON.stringify({ addendum: '' }) };
    }

    const data = await resp.json();
    const addendum = data?.choices?.[0]?.message?.content || '';
    return { statusCode: 200, body: JSON.stringify({ addendum }) };
  } catch (e) {
    // Never surface errors to the client; just omit the addendum.
    return { statusCode: 200, body: JSON.stringify({ addendum: '' }) };
  }
};
