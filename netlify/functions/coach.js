// netlify/functions/coach.js
export default async (req, context) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return new Response(JSON.stringify({ error:'Missing OPENAI_API_KEY' }), { status: 500 });

    const body = await req.json().catch(()=> ({}));
    const { context:ctx = 'plan_protocol', question = '', title = '', types = [], muscle_mass = 0, notes = '', metrics = {}, gates = {} } = body;

    // Safety summary
    const gateLines = [];
    if (gates.bpHigh) gateLines.push('BP gate: SBP≥160 or DBP≥100 — avoid HIIT/plyometrics.');
    if (gates.hrvLow) gateLines.push('HRV gate: ≤ −7% vs baseline — deload.');
    if (gates.sleepLow) gateLines.push('Sleep gate: efficiency <85% — deload.');
    if (gates.tirLow) gateLines.push('Glycemic gate: TIR <70% — prioritize resistance + Zone 2.');
    if (gates.crpHigh) gateLines.push('Inflammation gate: hs-CRP >3 mg/L — lower-impact, isometrics.');

    const sys = [
      'You are a clinical exercise coach for older adults with a cognition-first, safety-first approach.',
      'NEVER contradict or override safety gates. If advice might conflict, defer to gates.',
      'Be concise, 3–6 short sentences. No fluff. No emojis.',
      'Address: rationale (why), today’s tweak, simple monitoring/stop-rules, and one practical cue.',
    ].join(' ');

    const usr = [
      `Context: ${ctx}`,
      question ? `User question: ${question}` : '',
      title ? `Protocol: ${title}` : '',
      `Types: ${types.join(', ') || '—'}`,
      `Muscle-focus: ${muscle_mass ? 'yes' : 'no'}`,
      notes ? `Baseline coach script: ${notes}` : '',
      `Metrics: HRVΔ%=${metrics.hrvDeltaPct ?? '—'}, Sleep%=${metrics.sleepEff ?? '—'}, BP=${metrics.sbp ?? '—'}/${metrics.dbp ?? '—'}, TIR%=${metrics.tir ?? '—'}, CRP=${metrics.crp ?? '—'}`,
      gateLines.length ? `Safety gates active: ${gateLines.join(' ')} ` : 'Safety gates active: none.',
      'Your output must comply with gates and be additive to the baseline script.'
    ].filter(Boolean).join('\n');

    // OpenAI (Responses API style)
    const res = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content: sys },
          { role:'user', content: usr }
        ],
        max_output_tokens: 220,
        temperature: 0.3
      })
    });

    if (!res.ok) {
      const e = await res.text();
      return new Response(JSON.stringify({ error:'upstream_error', detail:e }), { status: 502 });
    }
    const j = await res.json();
    const addendum = (j.output?.[0]?.content?.[0]?.text || j.content?.[0]?.text || '').trim();

    // Simple guard: if the model contradicts gates, drop it (basic heuristic)
    if (gates.bpHigh && /hiit|plyo/i.test(addendum)) {
      return Response.json({ addendum: '' });
    }

    return Response.json({ addendum });
  } catch (e) {
    return new Response(JSON.stringify({ error:'server_error', detail:String(e) }), { status: 500 });
  }
};
