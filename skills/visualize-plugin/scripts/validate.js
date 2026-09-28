#!/usr/bin/env node
/* cutaway deterministic validation
 *   node validate.js --yaml <structure.yaml>   ... integrity checks on the canonical YAML (completion gate)
 *   node validate.js <file.excalidraw>         ... binding / coordinate / overflow checks on the generated figure
 *   node validate.js <file.html> [--yaml-source <structure.yaml>] [--style <render-style.yaml>]  ... self-containment / coverage / determinism checks on the HTML map
 * Findings are listed as "file:where:check: message"; exits 1 when any exist.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");

const findings = [];
const warns = [];
const SECTIONS = ["skills", "agents", "hooks", "commands", "mcp_servers",
  "lsp_servers", "monitors", "scripts", "data_references"];
const bad = (where, check, msg) => findings.push(`${where}:${check}: ${msg}`);
const warn = (where, check, msg) => warns.push(`${where}:${check}: ${msg}`);

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
    // Layout contract: `col` is per-lane execution order. Each lane's cols must start
    // at 0 and be consecutive (parallel nodes may share a col). Global numbering
    // across lanes degenerates the ELK layout into a vertical stack.
    for (const laneId of laneIds) {
      const cols = [...new Set((spec.flow.placement || [])
        .filter(p => p.lane === laneId && typeof p.col === "number")
        .map(p => p.col))].sort((a, b) => a - b);
      if (cols.length && (cols[0] !== 0 || cols[cols.length - 1] !== cols.length - 1)) {
        bad(F, `flow.lanes.${laneId}`, `cols must start at 0 and be consecutive within the lane: [${cols.join(", ")}]`);
      }
    }
    const laneOf = new Map((spec.flow.placement || []).map(p => [p.ref, p.lane]));
    const crossFlow = (spec.flow.edges || []).filter(e =>
      e.type !== "ref" && laneOf.get(e.from) !== laneOf.get(e.to));
    if (crossFlow.length > 1) {
      warn(F, "flow.edges", `${crossFlow.length} flow edges cross lanes (${crossFlow.map(e => `${e.from}->${e.to}`).join(", ")}) — design each lane as a linear flow with at most one connecting flow edge; feedback loops are type: ref`);
    }
    for (const z of spec.flow.zones || []) {
      if (!Array.isArray(z.cols) || z.cols.length !== 2) bad(F, "flow.zones", `cols must be [from, to]: ${z.label}`);
    }
  }
  // Scenarios: one `example_trace`, or several `example_traces` (id / label / summary / steps).
  const scenarios = [];
  if (Array.isArray(spec.example_traces)) {
    if (spec.example_trace) bad(F, "example_traces", "use either example_trace or example_traces, not both");
    const ids = new Set();
    spec.example_traces.forEach((t, i) => {
      const w = `example_traces[${i}]`;
      if (!t || !t.id || !t.label) bad(F, w, "id and label are required");
      if (t && t.id != null && !/^[A-Za-z0-9_-]+$/.test(String(t.id))) bad(F, `${w}.id`, `id must match [A-Za-z0-9_-]+: ${t.id}`);
      if (t && t.id != null) { if (ids.has(String(t.id))) bad(F, `${w}.id`, `duplicate id: ${t.id}`); ids.add(String(t.id)); }
      if (!t || !Array.isArray(t.steps)) bad(F, `${w}.steps`, "steps must be a list");
      scenarios.push({ where: `${w}.steps`, steps: (t && Array.isArray(t.steps)) ? t.steps : [] });
    });
  } else if (spec.example_trace) {
    scenarios.push({ where: "example_trace", steps: spec.example_trace });
  }
  const KINDS = ["user", "skill", "orchestrator", "agent", "mcp", "gate", "data", "script"];
  const refs = new Set(spec.flow && spec.flow.placement ? spec.flow.placement.map(p => p.ref) : []);
  for (const { where, steps } of scenarios) {
    steps.forEach((tr, i) => {
      if (!KINDS.includes(tr.kind)) bad(F, `${where}[${i}]`, `invalid kind: ${tr.kind}`);
      if (!tr.actor || !tr.text) bad(F, `${where}[${i}]`, "actor/text are required");
      if (tr.node != null && !refs.has(tr.node)) bad(F, `${where}[${i}].node`, `not in flow.placement: ${tr.node}`);
    });
    const n = steps.length;
    if (n < 3 || n > 12) bad(F, where, `unusual step count: ${n} (aim for 5-9)`);
    const resolvable = steps.some(tr => (tr.node != null && refs.has(tr.node)) || refs.has(tr.actor));
    if (refs.size && !resolvable) {
      warn(F, where, "no step resolves to a flow node; the HTML map cannot highlight this scenario (add node: to steps)");
    }
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
  // Arrow legibility metrics (warnings, not gates): crossings, near-parallel overlap,
  // and pass-through over unrelated labeled nodes. High counts usually mean the flow
  // YAML zigzags between lanes — fix the YAML, not the figure.
  const arrows = els.filter(el => el.type === "arrow" && Array.isArray(el.points) && el.points.length >= 2);
  const segsOf = el => {
    const pts = el.points.map(p => [el.x + p[0], el.y + p[1]]);
    return pts.slice(0, -1).map((p, i) => [p, pts[i + 1]]);
  };
  const crossing = (s1, s2) => {
    const [[ax, ay], [bx, by]] = s1, [[cx, cy], [dx, dy]] = s2;
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
  };
  const parallelOverlap = (s1, s2) => {
    const [a, b] = s1, [c, d] = s2;
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [d[0] - c[0], d[1] - c[1]];
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    if (l1 < 20 || l2 < 20) return false;
    if (Math.abs((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)) < 0.98) return false;
    const proj = p => {
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * v1[0] + (p[1] - a[1]) * v1[1]) / (l1 * l1)));
      const q = [a[0] + v1[0] * t, a[1] + v1[1] * t];
      return [Math.hypot(p[0] - q[0], p[1] - q[1]), t];
    };
    const [d1, t1] = proj(c), [d2, t2] = proj(d);
    if (Math.min(d1, d2) > 10) return false;
    return Math.min(Math.max(t1, t2), 1) - Math.max(Math.min(t1, t2), 0) > 0.25;
  };
  const segHitsBox = (s, box) => {
    const [[x1, y1], [x2, y2]] = s;
    const pad = -4;
    const rx1 = box.x - pad, ry1 = box.y - pad;
    const rx2 = box.x + box.width + pad, ry2 = box.y + box.height + pad;
    let inside = 0;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      if (px > rx1 && px < rx2 && py > ry1 && py < ry2) inside++;
    }
    return inside > 3;
  };
  let crossPairs = 0, overlapPairs = 0, nodePass = 0;
  for (let i = 0; i < arrows.length; i++) {
    for (let j = i + 1; j < arrows.length; j++) {
      const S1 = segsOf(arrows[i]), S2 = segsOf(arrows[j]);
      if (S1.some(a => S2.some(b => crossing(a, b)))) crossPairs++;
      else if (S1.some(a => S2.some(b => parallelOverlap(a, b)))) overlapPairs++;
    }
  }
  for (const ar of arrows) {
    const bound = new Set([ar.startBinding, ar.endBinding].filter(Boolean).map(b => b.elementId));
    if (solidBoxes.some(n => !bound.has(n.id) && segsOf(ar).some(s => segHitsBox(s, n)))) nodePass++;
  }
  if (crossPairs) warn(F, "arrows.crossing", `${crossPairs} arrow pair(s) cross — reduce lane hops in the flow YAML`);
  if (overlapPairs) warn(F, "arrows.overlap", `${overlapPairs} arrow pair(s) run nearly on top of each other`);
  if (nodePass) warn(F, "arrows.node-pass", `${nodePass} arrow(s) pass through an unrelated node`);
}

// ---------- HTML mode ----------
// The HTML map must be self-contained: no external scripts/styles/images/frames and no network APIs.
const FORBIDDEN_MARKUP = [
  [/<script[^>]*\ssrc\s*=/i, "external script"],
  [/<link[^>]*\shref\s*=\s*["']?(?:https?:)?\/\//i, "external stylesheet"],
  [/<iframe\b/i, "iframe"],
  [/<img[^>]*\ssrc\s*=\s*["']?(?:https?:)?\/\//i, "external image"],
];
const FORBIDDEN_CSS = [
  [/@import\b/i, "css @import"],
  [/url\(\s*["']?(?:https?:)?\/\//i, "external url()"],
];
const FORBIDDEN_SCRIPT = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|importScripts)\s*\(/;
const escAttr = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function validateHtml(file, yamlSource, stylePath) {
  const html = fs.readFileSync(file, "utf8");
  const F = path.basename(file);
  for (const [re, what] of FORBIDDEN_MARKUP) if (re.test(html)) bad(F, "external", `${what} found`);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
  for (const [re, what] of FORBIDDEN_CSS) if (re.test(styles)) bad(F, "external", `${what} found`);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
  if (FORBIDDEN_SCRIPT.test(scripts)) bad(F, "external", "network API in script");
  if (!yamlSource) {
    warn(F, "coverage", "no --yaml-source given; coverage and determinism checks skipped");
    return;
  }
  let spec;
  try {
    spec = yaml.load(fs.readFileSync(yamlSource, "utf8"));
  } catch (e) {
    bad(F, "yaml-source", `cannot read ${yamlSource}: ${String(e.message).split("\n")[0]}`);
    return;
  }
  for (const k of SECTIONS) {
    if (!html.includes(`data-panel="${escAttr(k)}"`)) bad(F, "coverage.panel", `panel missing: ${k}`);
  }
  const Fl = spec.flow;
  if (Fl && Fl.lanes && Fl.placement) {
    for (const p of Fl.placement) {
      if (!html.includes(`data-ref="${escAttr(p.ref)}"`)) bad(F, "coverage.node", `flow node missing: ${p.ref}`);
    }
    for (const e of Fl.edges || []) {
      if (!html.includes(`data-from="${escAttr(e.from)}" data-to="${escAttr(e.to)}"`)) {
        bad(F, "coverage.edge", `flow edge missing: ${e.from} -> ${e.to}`);
      }
    }
  }
  const scenarioList = Array.isArray(spec.example_traces) ? spec.example_traces
    : (spec.example_trace ? [{ id: "default", steps: spec.example_trace }] : []);
  if (scenarioList.length) {
    const want = scenarioList.reduce((n, t) => n + ((t && Array.isArray(t.steps)) ? t.steps.length : 0), 0);
    const stepCount = (html.match(/<li data-step="/g) || []).length;
    if (stepCount !== want) bad(F, "coverage.step", `trace steps: html has ${stepCount}, yaml has ${want}`);
    for (const m of html.matchAll(/<li data-step="\d+" data-node="([^"]*)"/g)) {
      if (!html.includes(`data-ref="${m[1]}"`)) bad(F, "coverage.step-node", `trace step node not in flow: ${m[1]}`);
    }
    if (Array.isArray(spec.example_traces)) {
      for (const t of spec.example_traces) {
        if (t && t.id != null && !html.includes(`data-scn="${escAttr(t.id)}"`)) bad(F, "coverage.scenario", `scenario missing: ${t.id}`);
      }
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutaway-validate-"));
  const tmp = path.join(dir, "re.html");
  try {
    const args = [path.join(__dirname, "convert.js"), yamlSource, "-o", tmp];
    if (stylePath) args.push("--style", stylePath);
    execFileSync(process.execPath, args, { stdio: "pipe" });
    if (!fs.readFileSync(tmp).equals(fs.readFileSync(file))) {
      bad(F, "determinism", "re-converting the YAML does not reproduce this file byte-for-byte");
    }
  } catch (e) {
    const detail = (e.stderr && String(e.stderr).trim()) || String(e.message).split("\n")[0];
    bad(F, "determinism", `re-conversion failed: ${detail}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- main ----------
const argv = process.argv.slice(2);
if (argv[0] === "--yaml") {
  if (!argv[1]) { console.error("usage: node validate.js --yaml <structure.yaml>"); process.exit(2); }
  validateYaml(argv[1]);
} else if (argv[0] && argv[0].toLowerCase().endsWith(".html")) {
  const i = argv.indexOf("--yaml-source");
  const j = argv.indexOf("--style");
  validateHtml(argv[0], i >= 0 ? argv[i + 1] : null, j >= 0 ? argv[j + 1] : null);
} else if (argv[0]) {
  validateExcalidraw(argv[0]);
} else {
  console.error("usage: node validate.js (--yaml <structure.yaml> | <file.excalidraw> | <file.html> [--yaml-source <structure.yaml>] [--style <render-style.yaml>])");
  process.exit(2);
}
for (const w of warns) console.error("WARN " + w);
if (findings.length) {
  for (const f of findings) console.error("NG " + f);
  console.error(`${findings.length} finding(s)`);
  process.exit(1);
}
console.log("OK " + argv.filter(a => a !== "--yaml")[0] + (warns.length ? ` (${warns.length} warning(s))` : ""));
