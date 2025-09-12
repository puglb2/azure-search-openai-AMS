async function callAOAI(url, messages, temperature, maxTokens, apiKey) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages,
      temperature,                 // keep = 1 for your model
      max_completion_tokens: maxTokens
    })
  });
  const ct = resp.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };
  return { resp, data };
}

module.exports = async function (context, req) {
  try {
    // ... (your existing initConfig + env var reads)

    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) {
      context.res = { status: 400, headers: { "Content-Type":"application/json" }, body: { error: "message required" } };
      return;
    }

    // keep history short to avoid bloat (last 8 messages if you’re passing history)
    // If you’re not keeping history server-side, ignore this.
    const baseMessages = [
      { role: "system", content: SYS_PROMPT || "You are a helpful intake assistant." },
      { role: "user",   content: userMessage }
    ];

    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview").trim();
    const endpoint   = process.env.AZURE_OPENAI_ENDPOINT.trim().replace(/\/+$/,"");
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT.trim();
    const apiKey     = process.env.AZURE_OPENAI_API_KEY.trim();
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    // 1st attempt
    let { resp, data } = await callAOAI(url, baseMessages, 1, 384, apiKey); // bump tokens a bit
    let choice = data?.choices?.[0];
    let reply  = choice?.message?.content?.trim() || "";
    const filtered = choice?.finish_reason === "content_filter" ||
      (Array.isArray(data?.prompt_filter_results) && data.prompt_filter_results.some(r => {
        const cfr = r?.content_filter_results; return cfr && Object.values(cfr).some(v => v?.filtered);
      }));

    // If empty or filtered, retry once with a tiny nudge
    if ((!reply || filtered) && resp.ok) {
      const nudged = [
        baseMessages[0],
        { role: "user", content: "Instruction: Respond in plain text (1–2 sentences). Do not call tools." },
        baseMessages[1]
      ];
      const second = await callAOAI(url, nudged, 1, 256, apiKey);
      resp = second.resp; data = second.data;
      choice = data?.choices?.[0];
      reply  = choice?.message?.content?.trim() || reply; // use new reply if we got one
    }

    if (!resp.ok) {
      context.res = { status: 502, headers: {"Content-Type":"application/json"}, body: { error: "LLM error", status: resp.status, detail: data } };
      return;
    }

    // Optional diagnostics: add ?debug=1 to the /api/chat URL to inspect
    if ((req.query?.debug === "1") && data) {
      context.res = {
        status: 200,
        headers: { "Content-Type":"application/json" },
        body: { reply: reply || "", finish_reason: choice?.finish_reason, prompt_filter_results: data?.prompt_filter_results, usage: data?.usage }
      };
      return;
    }

    context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply: reply || "" } };
  } catch (e) {
    context.res = { status: 500, headers: {"Content-Type":"application/json"}, body: { error: "server error", detail: String(e) } };
  }
};
