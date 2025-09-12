module.exports = async function (context, req) {
  try {
    const userMessage = req.body?.message?.trim();
    if (!userMessage) {
      context.res = { status: 400, headers: {"Content-Type":"application/json"}, body: { error: "message required" } };
      return;
    }

    const endpoint   = (process.env.AZURE_OPENAI_ENDPOINT || "").trim();
    const apiKey     = (process.env.AZURE_OPENAI_API_KEY || "").trim();
    const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT || "").trim();
    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview").trim();

    const url = `${endpoint.replace(/\/+$/,"")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: `
You are a warm, trauma-informed intake assistant. Keep answers concise and practical. Do not diagnose.

Crisis policy:
- Only treat as crisis if the user explicitly mentions suicidal thoughts, self-harm, or immediate danger.
- General requests like "I need mental help" are NOT crisis language.

Your job:
- Help users decide between psychiatry, therapy, or both.
- Ask at most 3 clarifying questions before making a suggestion.
- Then offer to match them to a provider.
            `.trim()
          },
          { role: "user", content: userMessage }
        ],
        temperature: 1,                // leave as-is for your model
        max_completion_tokens: 256     // supported param for new models
      })
    });

    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };

    if (!resp.ok) {
      context.res = { status: 502, headers: {"Content-Type":"application/json"}, body: { error: "LLM error", status: resp.status, detail: data } };
      return;
    }

    const reply = data?.choices?.[0]?.message?.content ?? "";
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { reply: reply || "" }
    };
  } catch (e) {
    context.res = { status: 500, headers: {"Content-Type":"application/json"}, body: { error: "server error", detail: String(e) } };
  }
};
