const fs = require("fs");
const path = require("path");

// --- Load & cache text files (once per cold start) ---
let SYS_PROMPT = "";
let FAQ_SNIPPET = "";
let POLICIES_SNIPPET = "";

function readIfExists(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function initConfig() {
  if (SYS_PROMPT) return; // already loaded
  const cfgDir = path.join(__dirname, "../_config");
  SYS_PROMPT = readIfExists(path.join(cfgDir, "system_prompt.txt")).trim();
  FAQ_SNIPPET = readIfExists(path.join(cfgDir, "faqs.txt")).trim();
  POLICIES_SNIPPET = readIfExists(path.join(cfgDir, "policies.txt")).trim();

  // Keep the system concise; append short “policy awareness” if available.
  if (FAQ_SNIPPET) {
    SYS_PROMPT += `

# FAQ (for quick reference; summarize when answering)
${FAQ_SNIPPET}`.trim();
  }
  if (POLICIES_SNIPPET) {
    SYS_PROMPT += `

# Policy notes (adhere to these)
${POLICIES_SNIPPET}`.trim();
  }
}

module.exports = async function (context, req) {
  try {
    initConfig();

    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "message required" }
      };
      return;
    }

    const endpoint   = (process.env.AZURE_OPENAI_ENDPOINT || "").trim();   // e.g. https://<resource>.openai.azure.com
    const apiKey     = (process.env.AZURE_OPENAI_API_KEY || "").trim();
    const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT || "").trim(); // EXACT deployment Name
    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview").trim();

    if (!endpoint || !apiKey || !deployment) {
      context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    // Build messages with your system instructions first.
    const messages = [
      {
        role: "system",
        content: SYS_PROMPT || (
`You are a warm, trauma-informed intake assistant. Keep answers concise and practical. Do not diagnose.

Crisis policy:
- Only treat as crisis if the user explicitly mentions suicidal thoughts, self-harm, or immediate danger.
- General requests like "I need mental help" are NOT crisis language.

Your job:
- Help users decide between psychiatry, therapy, or both.
- Ask at most 3 clarifying questions before making a suggestion.
- Then offer to match them to a provider.`.trim()
        )
      },
      { role: "user", content: userMessage }
    ];

    // Make the AOAI call (unchanged semantics; your model required temperature: 1)
    const url = `${endpoint.replace(/\/+$/,"")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages,
        temperature: 1,                 // keep as you required
        max_completion_tokens: 256      // use modern param name
      })
    });

    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };

    if (!resp.ok) {
      context.res = {
        status: 502,
        headers: { "Content-Type": "application/json" },
        body: { error: "LLM error", status: resp.status, detail: data }
      };
      return;
    }

    const reply = (data?.choices?.[0]?.message?.content || "").trim();

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { reply }
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: "server error", detail: String(e) }
    };
  }
};
