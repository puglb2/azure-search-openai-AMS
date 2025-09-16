// api/chat/index.js
const fs = require("fs");
const path = require("path");

// ---------- load & cache instruction files ----------
let SYS_PROMPT = "";
let FAQ_SNIPPET = "";
let POLICIES_SNIPPET = "";

function readIfExists(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }

function initConfig() {
  if (SYS_PROMPT) return; // already loaded
  const cfgDir = path.join(__dirname, "../_config");
  SYS_PROMPT      = readIfExists(path.join(cfgDir, "system_prompt.txt")).trim();
  FAQ_SNIPPET     = readIfExists(path.join(cfgDir, "faqs.txt")).trim();
  POLICIES_SNIPPET= readIfExists(path.join(cfgDir, "policies.txt")).trim();

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

// ---------- AOAI call helper ----------
async function callAOAI(url, messages, temperature, maxTokens, apiKey) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages,
      temperature,                 // your model needs 1
      max_completion_tokens: maxTokens
    })
  });
  const ct = resp.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await resp.json() : { text: await resp.text() };
  return { resp, data };
}

module.exports = async function (context, req) {
  try {
    initConfig();

    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) {
      context.res = { status: 400, headers: { "Content-Type":"application/json" }, body: { error: "message required" } };
      return;
    }

    // ---- SAFE reads of env vars (no undefined.trim()!) ----
    const apiVersion = ((process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview") + "").trim();
    const endpoint   = ((process.env.AZURE_OPENAI_ENDPOINT || "") + "").trim().replace(/\/+$/,"");   // e.g. https://<resource>.openai.azure.com
    const deployment = ((process.env.AZURE_OPENAI_DEPLOYMENT || "") + "").trim();
    const apiKey     = ((process.env.AZURE_OPENAI_API_KEY || "") + "").trim();

    if (!endpoint || !deployment || !apiKey) {
      context.res = { status: 200, headers: { "Content-Type":"application/json" }, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const baseMessages = [
      { role: "system", content: SYS_PROMPT || "You are a helpful intake assistant." },
      { role: "user",   content: userMessage }
    ];

    // First attempt
    let { resp, data } = await callAOAI(url, baseMessages, 1, 384, apiKey);
    let choice = data?.choices?.[0];
    let reply  = choice?.message?.content?.trim() || "";

    const filtered = choice?.finish_reason === "content_filter" ||
      (Array.isArray(data?.prompt_filter_results) && data.prompt_filter_results.some(r => {
        const cfr = r?.content_filter_results;
        return cfr && Object.values(cfr).some(v => v?.filtered);
      }));

    // Retry once with a tiny nudge if empty/filtered
    if ((!reply || filtered) && resp.ok) {
      const nudged = [
        baseMessages[0],
        { role: "user", content: "Instruction: Respond in plain text (1–2 sentences). Do not call tools." },
        baseMessages[1]
      ];
      const second = await callAOAI(url, nudged, 1, 256, apiKey);
      resp   = second.resp;
      data   = second.data;
      choice = data?.choices?.[0];
      reply  = choice?.message?.content?.trim() || reply;
    }

    if (!resp.ok) {
      context.res = { status: 502, headers: {"Content-Type":"application/json"}, body: { error: "LLM error", status: resp.status, detail: data } };
      return;
    }

    // Optional debug: /api/chat?debug=1
    if ((req.query?.debug === "1") && data) {
      context.res = {
        status: 200,
        headers: { "Content-Type":"application/json" },
        body: {
          reply: reply || "",
          finish_reason: choice?.finish_reason,
          prompt_filter_results: data?.prompt_filter_results,
          usage: data?.usage
        }
      };
      return;
    }

    context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply: reply || "" } };
  } catch (e) {
    // Return the error text so you can see what failed (temporarily; remove later if you prefer)
    context.res = { status: 500, headers: {"Content-Type":"application/json"}, body: { error: "server error", detail: String(e) } };
  }
};

extra_body: {
    data_sources: [
      {
        type: "azure_search",
        parameters: {
          endpoint: process.env.AZURE_SEARCH_ENDPOINT,    // https://<svc>.search.windows.net
          index_name: process.env.AZURE_SEARCH_INDEX,     // your index name
          authentication: {
            type: "api_key",
            key: process.env.AZURE_SEARCH_KEY             // use the QUERY key for read-only
          },
          // Retrieval tuning
          query_type: "vector_semantic_hybrid",           // strong default
          semantic_configuration: "default",              // if you created one in AI Search
          top_n_documents: 6,
          strictness: 3,
          // Map your index fields here (adjust to your schema)
          fields_mapping: {
            content_fields: ["content", "chunk", "page_content"],
            title_field: "title",
            filepath_field: "source",
            url_field: "url"
          },
          // Include citations & intent in the response context (optional)
          include_contexts: ["citations", "intent"]
        }
      }
    ]
  }
});
