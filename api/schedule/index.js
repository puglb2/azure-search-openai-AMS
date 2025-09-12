const fs = require("fs");
const path = require("path");

// provider_schedule_14d.txt format (pipe-delimited): slot_id | prov_id | Name | Type | 2025-09-01 11:30-12:20 (America/Phoenix) | Telehealth Only: Yes
function loadSlots() {
  const p = path.join(__dirname, "../_data/provider_schedule_14d.txt");
  const raw = fs.readFileSync(p, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slots = [];
  for (const line of lines) {
    const parts = line.split("|").map(s => s.trim());
    if (parts.length < 6) continue;
    const [slot_id, prov_id, name, type, window, tele] = parts;
    slots.push({ slot_id, prov_id, name, type, window, telehealth: /yes/i.test(tele) });
  }
  return slots;
}

let CACHE = null;
function getAll() { return (CACHE ||= loadSlots()); }

module.exports = async function (context, req) {
  const prov = (req.query.prov || "").trim();
  let items = getAll();
  if (prov) items = items.filter(s => s.prov_id === prov);
  // The system prompt expects 12-hour times and “(Arizona time)” labeling. We keep whatever’s in the file. :contentReference[oaicite:12]{index=12}
  context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { count: items.length, items: items.slice(0, 100) } };
};
