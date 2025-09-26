// Netlify Function (CommonJS) — path: /netlify/functions/coach.js
// Reads { prompt } and returns { text }. If OPENAI_API_KEY is missing or the call fails,
// it returns { text: "" } so the UI stays clean (no errors shown).

exports.handler = async (event, context) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const prompt = (body.prompt || "").trim();

    if (!prompt) return resp200({ text: "" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return resp200({ text: "" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: "system", content: "You are a clinical, supportive exercise coach for older adults focused on brain health. Be concise, evidence-aware, and avoid overstatement." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!r.ok) return resp200({ text: "" });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return resp200({ text });
  } catch {
    return resp200({ text: "" });
  }
};

function resp200(obj) {
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
