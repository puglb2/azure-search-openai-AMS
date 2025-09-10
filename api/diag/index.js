module.exports = async function (context, req) {
  const has = (v) => Boolean(v && String(v).trim().length > 0);

  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT || "";
  const apiKey     = process.env.AZURE_OPENAI_API_KEY || "";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "";

  const result = {
    azureOpenAI: {
      endpointPresent: has(endpoint),
      apiKeyPresent: has(apiKey),
      deploymentPresent: has(deployment),
      endpointHost: endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    }
  };

  // Try to verify the deployment exists WITHOUT returning secrets/content
  try {
    if (has(endpoint) && has(apiKey)) {
      const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments?api-version=2024-08-01-preview`;
      const r = await fetch(url, { headers: { "api-key": apiKey } });
      result.azureOpenAI.listStatus = r.status; // 200 expected
      if (r.ok) {
        const data = await r.json();
        const names = (data?.data || data?.deployments || []).map(d => d.id || d.name);
        result.azureOpenAI.deploymentsFound = names;
        result.azureOpenAI.deploymentMatches = names.includes(deployment);
      } else {
        result.azureOpenAI.errorPreview = await r.text();
      }
    }
  } catch (e) {
    result.azureOpenAI.listError = String(e);
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: result
  };
};
