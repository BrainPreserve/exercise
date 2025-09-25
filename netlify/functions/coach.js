// Netlify Function: /api/coach
// Requires environment variable OPENAI_API_KEY
export default async (req, context) => {
  try {
    const { prompt } = await req.json();
    if (!prompt || !prompt.trim()) {
      return new Response(JSON.stringify({ text: "" }), { status: 200, headers: { 'Content-Type': 'application/json' }});
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Graceful fallback if key not set (don’t break the UI)
      return new Response(JSON.stringify({ text: "" }), { status: 200, headers: { 'Content-Type': 'application/json' }});
    }

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a clinical, supportive exercise coach for older adults focused on brain health. Be concise and specific, avoid medical diagnosis, and never overstate evidence." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 220
      })
    });

    if (!completion.ok) {
      return new Response(JSON.stringify({ text: "" }), { status: 200, headers: { 'Content-Type': 'application/json' }});
    }
    const data = await completion.json();
    const text = data.choices?.[0]?.message?.content || "";
    return new Response(JSON.stringify({ text }), { status: 200, headers: { 'Content-Type': 'application/json' }});
  } catch (e) {
    return new Response(JSON.stringify({ text: "" }), { status: 200, headers: { 'Content-Type': 'application/json' }});
  }
};
