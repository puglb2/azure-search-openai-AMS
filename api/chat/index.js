// api/chat/index.js
const fs = require("fs");
const path = require("path");

// Ensure fetch exists in this Node runtime (SWA Functions may vary)
if (typeof fetch === "undefined") {
  // Prefer undici if available in the runtime
  try { global.fetch = require("undici").fetch; } catch { /* no-op */ }
}

// ---------- load & cache instruction files ----------
let SYS_PROMPT = "";
let FAQ_SNIPPET = "";
let POLICIES_SNIPPET = "";

function readIfExists(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }

function initConfig() {
  if (SYS_PROMPT) return; // already loaded
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
}

// ---------- HTTP helper with better diagnostics ----------
async function postJson(url, body, headers = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await resp.json().catch(() => ({})) : { text: await resp.text().catch(() => "") };
    return { resp, data };
  } finally {
    clearTimeout(id);
  }
}

// ---------- Build OYD block if Search is configured ----------
function buildOydBlock(env, safeMode) {
  const endpoint = ((env.AZURE_SEARCH_ENDPOINT || "") + "").trim().replace(/\/+$/,"");
  const key      = ((env.AZURE_SEARCH_KEY || "") + "").trim();
  const index    = ((env.AZURE_SEARCH_INDEX || "") + "").trim();

  if (!endpoint || !key || !index) return undefined;

  if (safeMode) {
    // Minimal/robust OYD block to rule out schema issues
    return {
      type: "azure_search",
      parameters: {
        endpoint,
        index_name: index,
        authentication: { type: "api_key", key },
        top_n_documents: 3,
        strictness: 3,
        query_type: "simple"
      }
    };
  }

  const queryType = ((env.AZURE_SEARCH_QUERY_TYPE || "vector_semantic_hybrid") + "").trim();
  const semantic  = ((env.AZURE_SEARCH_SEMANTIC_CONFIG || "") + "").trim();

  const block = {
    type: "azure_search",
    parameters: {
      endpoint,
      index_name: index,
      authentication: { type: "api_key", key },
      top_n_documents: 6,
      strictness: 3,
      query_type: queryType
    }
  };

  if (semantic) block.parameters.semantic_configuration = semantic;

  // Only map fields you actually have in your index.
  // If unsure, start without fields_mapping and add gradually.
  block.parameters.fields_mapping = {
    content_fields: ["content", "chunk", "page_content"],
    title_field: "title",
    filepath_field: "source",
    url_field: "url"
  };

  // Optional
  block.parameters.include_contexts = ["citations", "intent"];

  return block;
}

module.exports = async function (context, req) {
  try {
    initConfig();

    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) {
      context.res = { status: 400, headers: { "Content-Type":"application/json" }, body: { error: "message required" } };
      return;
    }

    // ---- Env vars (safe reads) ----
    const apiVersion = ((process.env.AZURE_OPENAI_API_VERSION || "2024-10-21") + "").trim();
    const endpoint   = ((process.env.AZURE_OPENAI_ENDPOINT || "") + "").trim().replace(/\/+$/,""); // e.g. https://<resource>.openai.azure.com
    const deployment = ((process.env.AZURE_OPENAI_DEPLOYMENT || "") + "").trim();
    const apiKey     = ((process.env.AZURE_OPENAI_API_KEY || "") + "").trim();

    if (!endpoint || !deployment || !apiKey) {
      context.res = { status: 200, headers: { "Content-Type":"application/json" }, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const oydEnabled = String(process.env.AZURE_OYD_ENABLED || "1") !== "0";
    const safeMode   = String(process.env.AZURE_SEARCH_SAFE_MODE || "0") === "1";
    const oydBlock   = oydEnabled ? buildOydBlock(process.env, safeMode) : undefined;

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const baseMessages = [
      { role: "system", content: SYS_PROMPT || "You are a helpful intake assistant." },
      { role: "user",   content: userMessage }
    ];

    // Prepare request body
    const requestBody = {
      messages: baseMessages,
      temperature: 0.2,
      max_tokens: 600
    };
    if (oydBlock) {
      requestBody.extra_body = { data_sources: [oydBlock] };
    }

    // --- Call AOAI (with simple retry for transient 429/503) ---
    let attempt = 0, result, resp, data;
    while (attempt < 2) {
      attempt++;
      result = await postJson(url, requestBody, { "api-key": apiKey });
      resp = result.resp; data = result.data;

      if (resp.status === 429 || resp.status === 503) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      break;
    }

    // Extract reply if success
    if (resp.ok) {
      const choice = data?.choices?.[0];
      let reply = (choice?.message?.content || "").trim();

      // Optional second try if content filtered / empty
      const filtered = choice?.finish_reason === "content_filter" ||
        (Array.isArray(data?.prompt_filter_results) && data.prompt_filter_results.some(r => {
          const cfr = r?.content_filter_results;
          return cfr && Object.values(cfr).some(v => v?.filtered);
        }));

      if ((!reply || filtered) && !req.query?.debug) {
        const nudgedBody = {
          messages: [
            baseMessages[0],
            { role: "user", content: "Instruction: Respond in plain text (1–2 sentences). Do not call tools." },
            baseMessages[1]
          ],
          temperature: 0.2,
          max_tokens: 400
        };
        if (oydBlock) nudgedBody.extra_body = { data_sources: [oydBlock] };
        const second = await postJson(url, nudgedBody, { "api-key": apiKey });
        if (second.resp.ok) {
          const c2 = second.data?.choices?.[0];
          reply = (c2?.message?.content || reply || "").trim();
        }
      }

      if (req.query?.debug === "1") {
        context.res = {
          status: 200,
          headers: { "Content-Type":"application/json" },
          body: {
            reply: reply || "",
            usage: data?.usage,
            finish_reason: data?.choices?.[0]?.finish_reason,
            had_oyd: !!oydBlock,
            api_version: apiVersion
          }
        };
        return;
      }

      context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply: reply || "" } };
      return;
    }

    // If non-2xx: return upstream status & details so you can fix quickly
    context.res = {
      status: resp.status, // <-- surface the actual upstream status, not 502
      headers: { "Content-Type":"application/json" },
      body: {
        error: "Upstream Azure OpenAI error",
        upstream_status: resp.status,
        detail: data,
        env_check: {
          has_OPENAI_ENDPOINT: !!endpoint,
          has_OPENAI_DEPLOYMENT: !!deployment,
          has_OPENAI_API_VERSION: !!apiVersion,
          has_SEARCH_ENDPOINT: !!process.env.AZURE_SEARCH_ENDPOINT,
          has_SEARCH_INDEX: !!process.env.AZURE_SEARCH_INDEX,
          has_SEARCH_KEY: !!process.env.AZURE_SEARCH_KEY,
          oyd_enabled: !!oydBlock,
          safe_mode: safeMode
        },
        hint: "If detail says unrecognized argument 'extra_body', try AZURE_OPENAI_API_VERSION=2024-05-01-preview; or set AZURE_OYD_ENABLED=0 to isolate."
      }
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "Content-Type":"application/json" },
      body: {
        error: "server error",
        detail: String(e),
        note: "Check SWA → Functions → Log stream for stack trace."
      }
    };
  }
};
