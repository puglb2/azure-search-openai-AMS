module.exports = async function (context, req) {
  try {
    const userMessage = req.body?.message?.trim();
    if (!userMessage) {
      context.res = { status: 400, headers: {"Content-Type":"application/json"}, body: { error: "message required" } };
      return;
    }

    const endpoint   = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey     = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiVersion = "2024-08-01-preview";

    if (!endpoint || !apiKey || !deployment) {
      context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const url = `${endpoint.replace(/\/+$/,"")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "" },
          { role: "user",   content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    const ct = resp.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };

    if (!resp.ok) {
      // 502 is what you’re seeing; now you’ll get the detail payload too.
      context.log("AOAI error", resp.status, body);
      context.res = { status: 502, headers: {"Content-Type":"application/json"}, body: { error: "LLM error", status: resp.status, detail: body } };
      return;
    }

    const reply = body?.choices?.[0]?.message?.content ?? "";
    context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply } };
  } catch (e) {
    context.log("chat error", String(e));
    context.res = { status: 500, headers: {"Content-Type":"application/json"}, body: { error: "server error" } };
  }
};
