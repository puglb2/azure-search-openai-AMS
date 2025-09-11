module.exports = async function (context, req) {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT || "";
  const apiKey     = process.env.AZURE_OPENAI_API_KEY || "";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "";

  const out = {
    endpointPresent: !!endpoint,
    apiKeyPresent: !!apiKey,
    deploymentPresent: !!deployment,
    endpointHost: endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  };

  try {
    if (endpoint && apiKey) {
      const url = `${endpoint.replace(/\/+$/,"")}/openai/deployments?api-version=2024-08-01-preview`;
      const r = await fetch(url, { headers: { "api-key": apiKey } });
      out.listStatus = r.status;                 // expect 200
      if (r.ok) {
        const data = await r.json();
        const names = (data?.data || data?.deployments || []).map(d => d.name || d.id);
        out.deploymentsFound = names;
        out.deploymentMatches = deployment ? names.includes(deployment) : false;
      } else {
        out.errorPreview = await r.text();
      }
    }
  } catch (e) {
    out.listError = String(e);
  }

  context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: out };
};
