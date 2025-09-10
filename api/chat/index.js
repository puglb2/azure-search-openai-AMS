import fetch from "node-fetch";
import { cfg } from "../shared/config.js";

export default async function (context, req) {
  const userMessage = (req.body && req.body.message) || "";
  if (!userMessage) {
    context.res = { status: 400, body: { error: "message required" } };
    return;
  }

  try {
    // Minimal echo with Azure OpenAI placeholder; replace with tool-calling logic
    if (!cfg.openaiEndpoint || !cfg.openaiKey || !cfg.openaiDeployment) {
      context.res = { status: 200, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const resp = await fetch(`${cfg.openaiEndpoint}/openai/deployments/${cfg.openaiDeployment}/chat/completions?api-version=2024-08-01-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": cfg.openaiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a warm, trauma-informed intake assistant. Keep answers concise. No diagnosis. If crisis language appears, advise 988 and stop." },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      context.log("OpenAI error:", resp.status, txt);
      context.res = { status: 502, body: { error: "LLM error" } };
      return;
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content ?? "(no content)";
    context.res = { status: 200, body: { reply } };
  } catch (e) {
    context.log("chat error", e);
    context.res = { status: 500, body: { error: "server error" } };
  }
}
