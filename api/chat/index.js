module.exports = async function (context, req) {
  try {
    const userMessage = req.body?.message?.trim();
    if (!userMessage) {
      context.res = { status: 400, headers: {"Content-Type":"application/json"}, body: { error: "message required" } };
      return;
    }

    const endpoint   = (process.env.AZURE_OPENAI_ENDPOINT || "").trim();    // e.g. https://<resource>.openai.azure.com
    const apiKey     = (process.env.AZURE_OPENAI_API_KEY || "").trim();
    const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT || "").trim();  // EXACT deployment Name
    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview").trim();

    if (!endpoint || !apiKey || !deployment) {
      context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const url = `${endpoint.replace(/\/+$/,"")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        // keep it minimal & widely compatible
        messages: [
          { role: "system", content: "You are a helpful intake assistant." },
          { role: "user",   content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 256
      })
    });

    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };

    if (!resp.ok) {
      context.res = { status: 502, headers: {"Content-Type":"application/json"}, body: { error: "LLM error", status: resp.status, detail: data } };
      return;
    }

    const reply = data?.choices?.[0]?.message?.content ?? "";
    context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply } };
  } catch (e) {
    context.res = { status: 500, headers: {"Content-Type":"application/json"}, body: { error: "server error", detail: String(e) } };
  }
};
