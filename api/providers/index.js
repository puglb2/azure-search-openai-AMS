import { cfg } from "../shared/config.js";

export default async function (context, req) {
  const q = (req.query && req.query.q) || "";
  // TODO: replace with Azure AI Search query using cfg.searchEndpoint + cfg.searchKey + cfg.searchIndex
  // Return a mock list for now
  const results = [
    { id: "prov_1", name: "Dr. Elena Park, PMHNP", type: "Psychiatry", reasons: ["ADHD", "anxiety"], telehealth: true },
    { id: "prov_2", name: "Jordan Kim, LCSW", type: "Therapy", reasons: ["trauma", "depression"], telehealth: true }
  ].filter(p => !q || JSON.stringify(p).toLowerCase().includes(String(q).toLowerCase()));
  context.res = { status: 200, body: { results } };
}
