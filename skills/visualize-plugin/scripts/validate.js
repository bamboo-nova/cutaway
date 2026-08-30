#!/usr/bin/env node
/* cutaway deterministic validation
 *   node validate.js --yaml <structure.yaml>   ... integrity checks on the canonical YAML (completion gate)
 *   node validate.js <file.excalidraw>         ... binding / coordinate / overflow checks on the generated figure
 * Findings are listed as "file:where:check: message"; exits 1 when any exist.
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const findings = [];
const bad = (where, check, msg) => findings.push(`${where}:${check}: ${msg}`);

// ---------- YAML mode ----------
function validateYaml(file) {
  const raw = fs.readFileSync(file, "utf8");
  const spec = yaml.load(raw);
  const onto = yaml.load(fs.readFileSync(path.resolve(__dirname, "../references/plugin-ontology.yaml"), "utf8"));
  const F = path.basename(file);

  if (spec.schema !== "plugin-structure/v1.1") bad(F, "schema", `not plugin-structure/v1.1: ${spec.schema}`);
  if (!(spec.dialect in (onto.dialects || {}))) bad(F, "dialect", `unknown dialect: ${spec.dialect}`);
  if (spec.lang && !["ja", "en"].includes(spec.lang)) bad(F, "lang", `lang must be ja|en: ${spec.lang}`);
  if (raw.includes("TODO(Claude)")) {
    const lines = raw.split("\n").map((l, i) => l.includes("TODO(Claude)") ? i + 1 : 0).filter(Boolean);
    bad(F, "todo", `TODO(Claude) markers remain (lines: ${lines.join(", ")})`);
  }
  const VIS = Object.keys(onto.visibility || {});
  const PROV = Object.keys(onto.provenance || {});
  const ROLES = Object.keys(onto.skill_roles || {});
  const SECTIONS = ["skills", "agents", "hooks", "commands", "mcp_servers",
    "lsp_servers", "monitors", "scripts", "data_references"];
  const C = spec.components || {};
  for (const k of SECTIONS) {
    const s = C[k];
    if (!s) { bad(F, "sections", `missing section: ${k} (declare it even when verified_empty)`); continue; }
    if (!VIS.includes(s.visibility)) bad(F, `${k}.visibility`, `invalid value: ${s.visibility}`);
    if (!PROV.includes(s.provenance)) bad(F, `${k}.provenance`, `invalid value: ${s.provenance}`);
    const n = (s.items || []).length;
    if (s.visibility === "verified" && n === 0) bad(F, `${k}.items`, "verified but items is empty");
    if (s.visibility !== "verified" && n > 0) bad(F, `${k}.items`, `${s.visibility} but items is non-empty`);
    for (const it of s.items || []) {
      if (it.provenance && !PROV.includes(it.provenance)) bad(F, `${k}.item`, `invalid provenance: ${it.provenance}`);
    }
  }
  const skills = (C.skills || {}).items || [];
  const skillIds = new Set(skills.map(s => s.id));
  for (const s of skills) {
    if (!ROLES.includes(s.role)) bad(F, `skills.${s.id}.role`, `not in ontology skill_roles: ${s.role}`);
  }
  const agents = (C.agents || {}).items || [];
  const agentIds = new Set(agents.map(x => x.id));
  for (const x of agents) {
    for (const u of x.used_by || []) {
      if (!skillIds.has(u)) bad(F, `agents.${x.id}.used_by`, `does not resolve to a skill: ${u}`);
    }
  }
  for (const g of (C.agents || {}).groups || []) {
    for (const id of g.ids || []) {
      if (!agentIds.has(id)) bad(F, `agents.groups.${g.label}`, `does not resolve to an agent: ${id}`);
    }
  }
  if (spec.flow) {
    const refs = new Set((spec.flow.placement || []).map(p => p.ref));
    const laneIds = new Set((spec.flow.lanes || []).map(l => l.id));
    for (const p of spec.flow.placement || []) {
      if (!skillIds.has(p.ref) && !p.kind) bad(F, `flow.placement.${p.ref}`, "neither a skill id nor a data node with a kind");
      if (!laneIds.has(p.lane)) bad(F, `flow.placement.${p.ref}`, `undefined lane: ${p.lane}`);
      if (typeof p.col !== "number") bad(F, `flow.placement.${p.ref}`, "col is not a number");
    }
    for (const e of spec.flow.edges || []) {
      for (const end of [e.from, e.to]) {
        if (!refs.has(end)) bad(F, "flow.edges", `node not in placement: ${end}`);
      }
      if (e.type && !["flow", "ref"].includes(e.type)) bad(F, "flow.edges", `type must be flow|ref: ${e.type}`);
    }
    for (const z of spec.flow.zones || []) {
      if (!Array.isArray(z.cols) || z.cols.length !== 2) bad(F, "flow.zones", `cols must be [from, to]: ${z.label}`);
    }
  }
  if (spec.example_trace) {
    const KINDS = ["user", "skill", "orchestrator", "agent", "mcp", "gate", "data", "script"];
    spec.example_trace.forEach((tr, i) => {
      if (!KINDS.includes(tr.kind)) bad(F, `example_trace[${i}]`, `invalid kind: ${tr.kind}`);
      if (!tr.actor || !tr.text) bad(F, `example_trace[${i}]`, "actor/text are required");
    });
    const n = spec.example_trace.length;
    if (n < 3 || n > 12) bad(F, "example_trace", `unusual step count: ${n} (aim for 5-9)`);
  }
}

// ---------- Excalidraw mode ----------
const chW = (c, fsz) => (c.charCodeAt(0) > 0x2000 ? fsz * 1.02 : fsz * 0.62);
const lineW = (l, fsz) => [...l].reduce((a, c) => a + chW(c, fsz), 0);

function validateExcalidraw(file) {
  const F = path.basename(file);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { bad(F, "json", e.message); return; }
  if (doc.type !== "excalidraw") bad(F, "type", `not an excalidraw document: ${doc.type}`);
  const els = doc.elements || [];
  const byId = new Map();
  for (const el of els) {
    if (byId.has(el.id)) bad(F, el.id, "duplicate id");
    byId.set(el.id, el);
    if (!Number.isFinite(el.width) || !Number.isFinite(el.height) || el.width < 0 || el.height < 0) {
      bad(F, el.id, `invalid width/height: ${el.width}x${el.height}`);
    }
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) bad(F, el.id, "x/y is not a number");
  }
  for (const el of els) {
    if (el.type === "text" && el.containerId) {
      const c = byId.get(el.containerId);
      if (!c) { bad(F, el.id, `unknown containerId: ${el.containerId}`); continue; }
      if (!(c.boundElements || []).some(b => b.id === el.id && b.type === "text")) {
        bad(F, el.id, "not registered in the container's boundElements");
      }
      const cx = c.x + (c.width - el.width) / 2, cy = c.y + (c.height - el.height) / 2;
      if (Math.abs(el.x - cx) > 1.5 || Math.abs(el.y - cy) > 1.5) {
        bad(F, el.id, `bound text not at real centered coordinates (dx=${(el.x - cx).toFixed(1)}, dy=${(el.y - cy).toFixed(1)})`);
      }
      const gate = c.type === "diamond";
      if (!gate && (el.width > c.width - 2 || el.height > c.height - 2)) {
        bad(F, el.id, `text overflows its container (text ${el.width}x${el.height} > box ${c.width}x${c.height})`);
      }
      // Re-measure with the same approximation the generator uses.
      const fsz = el.fontSize || 13;
      const maxLine = Math.max(...String(el.text).split("\n").map(l => lineW(l, fsz)));
      if (!gate && maxLine > c.width - 2) bad(F, el.id, `re-measured overflow (${Math.ceil(maxLine)} > ${c.width})`);
    }
    if (el.type === "arrow") {
      if (!Array.isArray(el.points) || el.points.length < 2) { bad(F, el.id, "not enough points"); continue; }
      const [p0] = el.points;
      if (p0[0] !== 0 || p0[1] !== 0) bad(F, el.id, `points[0] is not [0,0]: ${JSON.stringify(p0)}`);
      for (const [k, b] of [["startBinding", el.startBinding], ["endBinding", el.endBinding]]) {
        if (!b) continue;
        const tgt = byId.get(b.elementId);
        if (!tgt) { bad(F, el.id, `${k} target does not exist: ${b.elementId}`); continue; }
        if (!(tgt.boundElements || []).some(x => x.id === el.id && x.type === "arrow")) {
          bad(F, el.id, `${k} target is missing the arrow in boundElements`);
        }
      }
    }
  }
  // Overlap between flow nodes / chips (dashed boxes = panels/zones/data frames are excluded).
  const solidBoxes = els.filter(el =>
    (el.type === "rectangle" || el.type === "diamond") && el.strokeStyle === "solid" &&
    (el.boundElements || []).some(b => b.type === "text"));
  for (let i = 0; i < solidBoxes.length; i++) {
    for (let j = i + 1; j < solidBoxes.length; j++) {
      const a = solidBoxes[i], b = solidBoxes[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const contains = (p, q) => p.x <= q.x + 1 && p.y <= q.y + 1 &&
        p.x + p.width >= q.x + q.width - 1 && p.y + p.height >= q.y + q.height - 1;
      if (ox > 2 && oy > 2 && !contains(a, b) && !contains(b, a)) {
        bad(F, `${a.id}/${b.id}`, `nodes overlap (${Math.round(ox)}x${Math.round(oy)}px)`);
      }
    }
  }
}

// ---------- main ----------
const argv = process.argv.slice(2);
if (argv[0] === "--yaml") {
  if (!argv[1]) { console.error("usage: node validate.js --yaml <structure.yaml>"); process.exit(2); }
  validateYaml(argv[1]);
} else if (argv[0]) {
  validateExcalidraw(argv[0]);
} else {
  console.error("usage: node validate.js (--yaml <structure.yaml> | <file.excalidraw>)");
  process.exit(2);
}
if (findings.length) {
  for (const f of findings) console.error("NG " + f);
  console.error(`${findings.length} finding(s)`);
  process.exit(1);
}
console.log("OK " + argv.filter(a => a !== "--yaml")[0]);
