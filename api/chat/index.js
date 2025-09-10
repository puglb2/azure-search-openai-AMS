module.exports = async function (context, req) {
  try {
    const userMessage = (req.body && req.body.message) || "";
    if (!userMessage) {
      context.res = { status: 400, headers: { "Content-Type": "application/json" }, body: { error: "message required" } };
      return;
    }

    const endpoint   = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey     = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

    if (!endpoint || !apiKey || !deployment) {
      context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a warm, trauma-informed intake assistant. Keep answers concise. No diagnosis. If crisis language appears, advise 988 and stop." },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    const ct = resp.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };

    if (!resp.ok) {
      context.log("OpenAI error:", resp.status, body);
      context.res = {
        status: 502,
        headers: { "Content-Type": "application/json" },
        body: { error: "LLM error", status: resp.status, detail: body }
      };
      return;
    }

    const reply = body?.choices?.[0]?.message?.content ?? "(no content)";
    context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { reply } };
  } catch (e) {
    context.log("chat error", String(e));
    context.res = { status: 500, headers: { "Content-Type": "application/json" }, body: { error: "server error" } };
  }
};
