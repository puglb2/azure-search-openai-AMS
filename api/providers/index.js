const fs = require("fs");
const path = require("path");

// providers_100.txt format: blocks starting with "prov_### <tab> Name — Type" and indented fields
function loadProviders() {
  const p = path.join(__dirname, "../_data/providers_100.txt");
  const raw = fs.readFileSync(p, "utf8");
  const lines = raw.split(/\r?\n/);

  const out = [];
  let cur = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^prov_\d+\t/i.test(line)) {
      if (cur) out.push(cur);
      const [idPart, rest] = line.split("\t");
      const m = rest.match(/^(.*?)\s+—\s+(\w+)/); // "Name — Therapy/Psychiatry/Both"
      cur = {
        id: idPart.trim(),
        name: m ? m[1].trim() : rest.trim(),
        type: m ? m[2].trim() : "Therapy",
        styles: [],
        lived: [],
        languages: [],
        licensed: [],
        insurance: [],
        email: ""
      };
    } else if (cur) {
      const t = line.trim();
      if (t.startsWith("Styles:")) cur.styles = t.replace("Styles:", "").split(",").map(s => s.trim());
      else if (t.startsWith("Lived experience:")) cur.lived = t.replace("Lived experience:", "").split(",").map(s => s.trim());
      else if (t.startsWith("Languages:")) cur.languages = t.replace("Languages:", "").split(",").map(s => s.trim());
      else if (t.startsWith("Licensed states:")) cur.licensed = t.replace("Licensed states:", "").split(",").map(s => s.trim());
      else if (t.startsWith("Insurance:")) cur.insurance = t.replace("Insurance:", "").split(",").map(s => s.trim());
      else if (t.startsWith("Email:")) cur.email = t.replace("Email:", "").trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

let CACHE = null;
function getAll() { return (CACHE ||= loadProviders()); }

module.exports = async function (context, req) {
  const q    = (req.query.q || "").toLowerCase().trim();
  const type = (req.query.type || "").trim();         // Therapy|Psychiatry|Both
  const zip  = (req.query.zip || "").trim();          // optional future use

  let items = getAll();

  if (type) items = items.filter(p => p.type.toLowerCase() === type.toLowerCase());
  if (q) {
    items = items.filter(p => {
      const hay = [
        p.id, p.name, p.type,
        ...p.styles, ...p.lived, ...p.languages, ...p.licensed, ...p.insurance
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { count: items.length, items: items.slice(0, 50) } };
};
