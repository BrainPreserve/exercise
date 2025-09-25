// Netlify Function (CommonJS) — path: /netlify/functions/coach.js
// Reads { prompt } and returns { text }. If OPENAI_API_KEY is missing or the call fails,
// it returns { text: "" } so the UI stays clean (no errors shown).

exports.handler = async (event, context) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const prompt = (body.prompt || "").trim();

    // Empty prompt → return empty text (keeps UI clean)
    if (!prompt) {
      return resp200({ text: "" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Graceful fallback if the key isn’t set yet
      return resp200({ text: "" });
    }

    // Netlify Node 18+ exposes global fetch
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
          {
            role: "system",
            content:
              "You are a clinical, supportive exercise coach for older adults focused on brain health. Be concise, evidence-aware, and avoid medical diagnosis or overstatement."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!r.ok) {
      // If OpenAI is unavailable, don’t break the app—return empty text
      return resp200({ text: "" });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return resp200({ text });
  } catch (_err) {
    return resp200({ text: "" });
  }
};

function resp200(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
