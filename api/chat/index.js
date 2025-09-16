// api/chat/index.js
const fs = require("fs");
const path = require("path");

// ---------- load & cache instruction files ----------
let SYS_PROMPT = "";
let FAQ_SNIPPET = "";
let POLICIES_SNIPPET = "";

function readIfExists(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }

function initConfig() {
  if (SYS_PROMPT) return; // already loaded this cold start
  const cfgDir = path.join(__dirname, "../_config");
  SYS_PROMPT       = readIfExists(path.join(cfgDir, "system_prompt.txt")).trim();
  FAQ_SNIPPET      = readIfExists(path.join(cfgDir, "faqs.txt")).trim();
  POLICIES_SNIPPET = readIfExists(path.join(cfgDir, "policies.txt")).trim();

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

  // Strong, model-friendly guardrails to avoid blank replies or tool calls
  SYS_PROMPT += `

# Response format:
- Always produce a plain-text answer (no tools).
- Keep answers concise (1–3 short paragraphs max).
- Routine help requests are not crisis; only explicit self-harm or immediate danger is crisis.`;
}

// ---------- helpers ----------
async function callAOAI(url, messages, temperature, maxTokens, apiKey) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ messages, temperature, max_completion_tokens: maxTokens })
  });
  const ct = resp.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };
  return { resp, data };
}

async function querySearch(q) {
  const endpoint = ((process.env.AZURE_SEARCH_ENDPOINT || "") + "").trim().replace(/\/+$/,"");
  const key      = ((process.env.AZURE_SEARCH_KEY || "") + "").trim();
  const index    = ((process.env.AZURE_SEARCH_INDEX || "") + "").trim();
  const semantic = ((process.env.AZURE_SEARCH_SEMANTIC_CONFIG || "") + "").trim();

  if (!endpoint || !key || !index || !q) return [];

  const url = `${endpoint}/indexes/${encodeURIComponent(index)}/docs/search?api-version=2023-11-01`;
  const body = {
    search: q,
    top: 5,
    queryType: "semantic",
    semanticConfiguration: semantic || undefined,
    searchFields: "*",
    queryLanguage: "en-us",
    speller: "lexicon",
    captions: "extractive",
    answers: "extractive|count-3"
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": key },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) return [];

  const items = (data.value || []).map(doc => {
    const text = (doc["@search.captions"]?.[0]?.text) || doc.content || doc.text || "";
    const source = doc.source || doc.url || doc.type || "";
    const score = doc["@search.score"];
    return { text, source, score };
  }).filter(x => x.text && x.text.trim());

  return items.slice(0, 3);
}

if (ALWAYS_SEARCH || looksInfoSeeking(userMessage)) {
  // Very lightweight heuristic—tune as needed
  return /insurance|in[-\s]*network|bcbs|blue\s*cross|polic(y|ies)|copay|benefit|provider|schedule|availability|psychiatr|therap/i.test(msg);
}

// ---------- main function ----------
const ALWAYS_SEARCH = ((process.env.AMS_ALWAYS_SEARCH || "") + "").trim().toLowerCase() === "true";
module.exports = async function (context, req) {
  try {
    initConfig();

    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) {
      context.res = { status: 400, headers: { "Content-Type":"application/json" }, body: { error: "message required" } };
      return;
    }

    // Safe env reads
    const apiVersion = ((process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview") + "").trim();
    const endpoint   = ((process.env.AZURE_OPENAI_ENDPOINT || "") + "").trim().replace(/\/+$/,"");
    const deployment = ((process.env.AZURE_OPENAI_DEPLOYMENT || "") + "").trim();
    const apiKey     = ((process.env.AZURE_OPENAI_API_KEY || "") + "").trim();

    if (!endpoint || !deployment || !apiKey) {
      context.res = { status: 200, headers: { "Content-Type":"application/json" }, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    // ---- (optional) retrieval: add short grounded context when the message looks info-seeking ----
    let contextBlock = "";
    let searchItems = [];
    if (looksInfoSeeking(userMessage)) {
      searchItems = await querySearch(userMessage.slice(0, 300));
      if (searchItems.length) {
        const bulletList = searchItems.map(x => `- ${x.text}`).join("\n");
        contextBlock = `\n\n# Retrieved context (use to ground your answer; prefer concise summaries):\n${bulletList}`;
      }
    }

    // ---- Bring in recent chat history from the client (optional) ----
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const normalizedHistory = history.slice(-8).map(m => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: ((m?.content || '') + '').trim()
    })).filter(m => m.content);

    // ---- Build messages: system -> prior turns -> latest user ----
    const messages = [
      { role: "system", content: (SYS_PROMPT || "You are a helpful intake assistant.") + contextBlock },
      ...normalizedHistory,
      { role: "user",   content: userMessage }
    ];

    // First attempt (give enough room to answer)
    let { resp, data } = await callAOAI(url, messages, 1, 384, apiKey);
    let choice = data?.choices?.[0];
    let reply  = (choice?.message?.content || "").trim();

    const filtered = choice?.finish_reason === "content_filter" ||
      (Array.isArray(data?.prompt_filter_results) && data.prompt_filter_results.some(r => {
        const cfr = r?.content_filter_results;
        return cfr && Object.values(cfr).some(v => v?.filtered);
      }));

    // If empty or filtered, retry once with a firmer nudge (keep history + context)
    if ((!reply || filtered) && resp.ok) {
      const nudged = [
        { role: "system", content: (SYS_PROMPT || "You are a helpful intake assistant.") + `
- Always respond in plain text (no tools), 1–2 sentences unless the user asks for detail.
- If nothing is appropriate to say, reply with a brief clarification question.
` + contextBlock },
        ...normalizedHistory,
        { role: "user", content: userMessage }
      ];
      const second = await callAOAI(url, nudged, 1, 256, apiKey);
      resp   = second.resp;
      data   = second.data;
      choice = data?.choices?.[0];
      reply  = (choice?.message?.content || "").trim() || reply; // keep first if still empty
    }

    // If still empty, provide a final safe fallback (prevents "" at the UI)
    if (!reply) {
      reply = "I can help you decide between therapy, psychiatry, or both and match you with a provider. Could you share a bit about your goals, any symptoms, and your insurance? (If you’re in immediate danger, please call 988.)";
    }

    if (!resp.ok) {
      context.res = { status: 502, headers: {"Content-Type":"application/json"}, body: { error: "LLM error", status: resp.status, detail: data } };
      return;
    }

    // Optional debug: /api/chat?debug=1
    if (req.query?.debug === "1") {
      context.res = {
        status: 200,
        headers: { "Content-Type":"application/json" },
        body: {
          reply,
          finish_reason: choice?.finish_reason,
          prompt_filter_results: data?.prompt_filter_results,
          usage: data?.usage,
          sys_prompt_bytes: (SYS_PROMPT || "").length,
          files_present: { system_prompt: !!SYS_PROMPT, faqs: !!FAQ_SNIPPET, policies: !!POLICIES_SNIPPET },
          search_used: !!contextBlock,
          search_items: searchItems,
          history_len: normalizedHistory.length
        }
      };
      return;
    }

    context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply } };
  } catch (e) {
    context.res = { status: 500, headers: {"Content-Type":"application/json"}, body: { error: "server error", detail: String(e) } };
  }
};
