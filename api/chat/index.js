module.exports = async function (context, req) {
  const userMessage = req.body?.message?.trim();
  if (!userMessage) {
    context.res = { status: 400, headers: { "Content-Type": "application/json" }, body: { error: "message required" } };
    return;
  }

  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT;    // e.g. https://<resource>.openai.azure.com
  const apiKey     = process.env.AZURE_OPENAI_API_KEY;     // Key 1/2
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;  // your deployment name
  const apiVersion = "2024-08-01-preview";

  const url = `${endpoint.replace(/\/+$/,"")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "" }, // you can leave blank or inject your instructions
        { role: "user",   content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 300
    })
  });

  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await r.json() : { text: await r.text() };
  if (!r.ok) {
    context.res = { status: 502, headers: { "Content-Type": "application/json" }, body: { error: "LLM error", status: r.status, detail: data } };
    return;
  }

  const reply = data?.choices?.[0]?.message?.content ?? "";
  context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { reply } };
};
