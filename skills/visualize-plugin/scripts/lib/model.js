/* cutaway Layer 3 shared model: structure YAML -> labels/style, wrapped text, panel chips,
 * flow node specs + ELK layout, trace steps. Consumed by emit/excalidraw.js and emit/html.js.
 * No randomness, no time: the same YAML always yields the same model. */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const ELK = require("elkjs");
const elk = new ELK();

const SCHEMA = "plugin-structure/v1.1";
const DEFAULT_ROLE_COLOR = {
  orchestrator: ["#6741d9", "#d0bfff"], gate: ["#e8590c", "#ffd8a8"],
  generator: ["#1971c2", "#a5d8ff"], agent: ["#0c8599", "#99e9f2"],
  mcp: ["#2f9e44", "#b2f2bb"], script: ["#9c36b5", "#eebefa"],
  data: ["#495057", "#f1f3f5"], user: ["#495057", "#e9ecef"],
  hook: ["#c92a2a", "#ffc9c9"],
};
// example_trace kind -> palette key (was KC in convert.js; unknown kinds fall back to "generator" = KC.skill)
const TRACE_ROLE = { user: "user", skill: "generator", orchestrator: "orchestrator", agent: "agent",
  mcp: "mcp", gate: "gate", data: "data", script: "script" };

// ---- text width approximation and wrapping (moved verbatim from convert.js) ----
const chW = (c, fsz) => (c.charCodeAt(0) > 0x2000 ? fsz * 1.02 : fsz * 0.62);
const lineW = (l, fsz) => [...l].reduce((a, c) => a + chW(c, fsz), 0);
function tokenize(raw) {
  const toks = []; let cur = "";
  for (const ch of raw) {
    if (ch === " ") { if (cur) toks.push(cur); toks.push(" "); cur = ""; }
    else if (ch.charCodeAt(0) > 0x2000) { if (cur) toks.push(cur); toks.push(ch); cur = ""; }
    else cur += ch;
  }
  if (cur) toks.push(cur);
  return toks;
}
function wrap(text, fsz, maxW) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    let line = "";
    for (const tok of tokenize(raw)) {
      if (lineW(line + tok, fsz) > maxW && line.trim()) {
        out.push(line.trimEnd());
        line = tok === " " ? "" : tok;
      } else line += tok;
      while (lineW(line, fsz) > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && lineW(line.slice(0, cut), fsz) > maxW) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
const blockWH = (lines, fsz) =>
  [Math.ceil(Math.max(...lines.map(l => lineW(l, fsz)))), Math.ceil(lines.length * fsz * 1.35)];

function loadSpec(inputPath) {
  const rawText = fs.readFileSync(inputPath, "utf8");
  const spec = yaml.load(rawText);
  if (!spec || spec.schema !== SCHEMA) {
    throw new Error(`schema must be ${SCHEMA} (got: ${spec && spec.schema})`);
  }
  return { rawText, spec };
}

function buildContext(spec, stylePath) {
  const STYLE = yaml.load(fs.readFileSync(
    stylePath || path.resolve(__dirname, "../../references/render-style.yaml"), "utf8"));
  const ROLE_COLOR = Object.assign({}, DEFAULT_ROLE_COLOR, STYLE.palette || {});
  const ROLE_COLOR_DARK = {};
  for (const k of Object.keys(ROLE_COLOR)) ROLE_COLOR_DARK[k] = (STYLE.palette_dark || {})[k] || ROLE_COLOR[k];
  const lang = spec.lang === "en" ? "en" : "ja";
  const LBL = (STYLE.labels || {})[lang] || {};
  return {
    STYLE, ROLE_COLOR, ROLE_COLOR_DARK, lang, LBL,
    VIS_LABEL: LBL.visibility || {}, SPEC_LABEL: LBL.spec_status || {},
    DIALECT_LABEL: LBL.dialect || {}, UI: LBL.ui || {},
    RB: lang === "en" ? ["[", "]"] : ["〔", "〕"],
  };
}

function buildHeader(spec, ctx) {
  const { LBL, DIALECT_LABEL } = ctx;
  return {
    title: spec.title || "plugin structure map",
    dialectNote: DIALECT_LABEL[spec.dialect] || spec.dialect || null,
    overview: (spec.plugin && spec.plugin.overview) ? spec.plugin.overview : null,
    note: spec.note || null,
    legend: LBL.legend || [],
    legendPrefix: LBL.legend_prefix || "",
    legendSuffix: LBL.legend_suffix || null,
    pluginName: (spec.plugin && spec.plugin.name) || "plugin",
    pluginVersion: (spec.plugin && spec.plugin.version) || null,
  };
}

function buildPanels(spec, ctx) {
  const { UI, RB, VIS_LABEL, SPEC_LABEL, ROLE_COLOR } = ctx;
  const C = spec.components || {};
  const sec = k => C[k] || { visibility: "not_visible", items: [] };
  const skillChipText = s => `${s.id}\n${RB[0]}${s.role || UI.unclassified || "?"}${RB[1]}`;
  function agentChips(section) {
    const list = section.items || [];
    const groups = section.groups || null;
    if (groups && groups.length) {
      const grouped = new Set(groups.flatMap(g => g.ids || []));
      const chips = groups.map(g => ({
        text: `${g.label}${(UI.group_count || "({n})").replace("{n}", String((g.ids || []).length))}`
          + `\n→ ${[...new Set((g.ids || []).flatMap(id => (list.find(a => a.id === id) || {}).used_by || []))].join(", ")}`
          + (g.note ? `\n${g.note}` : ""),
        role: "agent",
      }));
      for (const a of list.filter(a => !grouped.has(a.id))) {
        chips.push({ text: `${a.id}\n→ ${(a.used_by || []).join(", ")}${a.note ? "\n" + a.note : ""}`, role: "agent" });
      }
      return chips;
    }
    const render = a => ({ text: `${a.id}\n→ ${(a.used_by || []).join(", ")}${a.note ? "\n" + a.note : ""}`, role: "agent" });
    if (list.length > 12) {
      return [...list.slice(0, 10).map(render),
        { text: (UI.agents_more || "…{n}").replace("{n}", String(list.length - 10)), role: "agent" }];
    }
    return list.map(render);
  }
  const PANEL_DEFS = [
    { key: "skills", base: "Skills", chips: s => (s.items || []).map(it => ({ text: skillChipText(it), role: ROLE_COLOR[it.role] ? it.role : "generator" })) },
    { key: "agents", base: "Agents", chips: agentChips },
    { key: "hooks", base: "Hooks", chips: s => (s.items || []).map(it => ({
        text: `${it.event}${it.matcher ? `（${it.matcher}）` : ""} → ${it.type}\n${it.command || ""}`, role: "hook" })) },
    { key: "commands", base: "Commands", chips: s => (s.items || []).map(it => ({ text: `${it.id}\n${it.description || ""}`, role: "command" })) },
    { key: "mcp_servers", base: "MCP servers", chips: s => (s.items || []).map(it => ({
        text: `${it.name}（${it.tools != null ? it.tools + (UI.tools_suffix || " tools") : (UI.tools_unknown || "?")}）`
          + (it.external ? (UI.external_tag || "") : "") + (it.note ? `\n${it.note}` : ""), role: "mcp" })) },
    { key: "lsp_servers", base: "LSP servers", chips: s => (s.items || []).map(it => ({ text: `${it.name}${it.note ? "\n" + it.note : ""}`, role: "data" })) },
    { key: "monitors", base: "Monitors", chips: s => (s.items || []).map(it => ({ text: `${it.name}${it.note ? "\n" + it.note : ""}`, role: "data" })) },
    { key: "scripts", base: "Scripts", chips: s => (s.items || []).map(it => ({ text: `${it.file}${it.note ? "\n" + it.note : ""}`, role: "script" })) },
    { key: "data_references", base: "Data / References", chips: s => (s.items || []).map(it => ({ text: `${it.file}${RB[0]}${it.kind}${RB[1]}${it.note ? "\n" + it.note : ""}`, role: "data" })) },
  ];
  function panelTitle(def, section) {
    const vis = section.visibility || "not_visible";
    const vl = VIS_LABEL[vis] || {};
    const t = (vl.title || "（{n}）").replace("{n}", String((section.items || []).length));
    const oos = section.spec_status === "out-of-spec" ? (SPEC_LABEL["out-of-spec"] || "") : "";
    return def.base + t + oos;
  }
  function panelNote(section) {
    if (section.note) return section.note;
    const vl = VIS_LABEL[section.visibility] || {};
    return vl.note || "";
  }
  return PANEL_DEFS.map(def => {
    const section = sec(def.key);
    const chips = def.chips(section);
    return { key: def.key, base: def.base, section, title: panelTitle(def, section), chips,
      note: chips.length ? null : (panelNote(section) || UI.none || "-") };
  });
}

async function buildFlow(spec, ctx) {
  const F = spec.flow;
  if (!(F && F.lanes && F.placement)) return null;
  const { STYLE } = ctx;
  const skills = ((spec.components || {}).skills || {}).items || [];
  const findSkill = id => skills.find(s => s.id === id);
  const NODE_MAXW = 235, NFS = 12.5;
  function flowNodeSpec(p) {
    const s = findSkill(p.ref);
    const kind = p.kind || (s && s.role) || "data";
    const lines = [];
    const order = s && s.pipeline_order ? (["①", "②", "③", "④", "⑤"][s.pipeline_order - 1] || `(${s.pipeline_order})`) + " " : "";
    lines.push(...wrap(order + p.ref, NFS, NODE_MAXW));
    const desc = p.desc || (s && s.description) || "";
    if (desc) lines.push(...wrap(desc, NFS, NODE_MAXW));
    if (s && s.uses) {
      const u = s.uses;
      if (u.mcp && Object.keys(u.mcp).length) lines.push(...wrap("MCP: " + Object.keys(u.mcp).join(" / "), NFS, NODE_MAXW));
      if (u.agents && u.agents.length) lines.push(...wrap("Agent: " + u.agents.join(", "), NFS, NODE_MAXW));
      if (u.scripts && u.scripts.length) lines.push(...wrap("Script: " + u.scripts.map(f => f.split("/").pop()).join(", "), NFS, NODE_MAXW));
    }
    const [tw, th] = blockWH(lines, NFS);
    const gate = (STYLE.shapes && STYLE.shapes[kind]) === "diamond" || kind === "gate";
    return { kind, lines, text: lines.join("\n"), w: gate ? tw + 110 : tw + 30, h: gate ? th + 66 : th + 22, gate };
  }
  const nodeSpecs = {};
  for (const p of F.placement) nodeSpecs[p.ref] = { ...flowNodeSpec(p), ...p };
  async function layoutLane(laneId) {
    const nodes = F.placement.filter(n => n.lane === laneId);
    const ids = new Set(nodes.map(n => n.ref));
    const edges = (F.edges || []).filter(e => ids.has(e.from) && ids.has(e.to));
    return elk.layout({
      id: "root_" + laneId,
      layoutOptions: {
        "elk.algorithm": "layered", "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL", "elk.partitioning.activate": "true",
        "elk.spacing.nodeNode": "55", "elk.layered.spacing.nodeNodeBetweenLayers": "115",
        "elk.layered.spacing.edgeNodeBetweenLayers": "35", "elk.spacing.edgeEdge": "22",
        "elk.spacing.edgeNode": "26",
      },
      children: nodes.map(n => ({ id: n.ref, width: nodeSpecs[n.ref].w, height: nodeSpecs[n.ref].h,
        layoutOptions: { "elk.partitioning.partition": String(n.col) } })),
      edges: edges.map((e, i) => ({ id: `${laneId}_e${i}`, sources: [e.from], targets: [e.to], _spec: e })),
    });
  }
  const laid = {};
  for (const lane of F.lanes) laid[lane.id] = await layoutLane(lane.id);
  return { F, nodeSpecs, laid, mainLane: F.lanes[0].id, NFS };
}

// Trace step -> flow node. Order: explicit `node`, then `actor` that is a placement ref,
// then the previous step's node; steps before the first resolvable one stay null.
function resolveSteps(raw, F) {
  const refs = new Set(F && F.placement ? F.placement.map(p => p.ref) : []);
  let last = null;
  return (raw || []).map((st, i) => {
    let node = null;
    if (st.node != null && refs.has(st.node)) node = st.node;
    else if (refs.has(st.actor)) node = st.actor;
    else node = last;
    last = node;
    return { n: i + 1, actor: st.actor, kind: st.kind, role: TRACE_ROLE[st.kind] || "generator", text: st.text, node };
  });
}

// Scenarios: `example_traces` lists several usage patterns (id / label / summary / steps);
// the single `example_trace` shorthand becomes one unlabeled scenario with id "default".
function buildTraces(spec) {
  const F = spec.flow;
  if (Array.isArray(spec.example_traces) && spec.example_traces.length) {
    return spec.example_traces.map((t, i) => {
      const tt = t || {};
      return { id: String(tt.id || `s${i + 1}`), label: tt.label || String(tt.id || i + 1),
        summary: tt.summary || null, steps: resolveSteps(tt.steps, F) };
    });
  }
  if (spec.example_trace) return [{ id: "default", label: null, summary: null, steps: resolveSteps(spec.example_trace, F) }];
  return null;
}

async function buildModel(inputPath, stylePath) {
  const { rawText, spec } = loadSpec(inputPath);
  const ctx = buildContext(spec, stylePath);
  const traces = buildTraces(spec);
  return { rawText, spec, ctx, header: buildHeader(spec, ctx), panels: buildPanels(spec, ctx),
    flow: await buildFlow(spec, ctx), traces, trace: traces ? traces[0].steps : null };
}

module.exports = { SCHEMA, buildModel, loadSpec, buildContext, chW, lineW, tokenize, wrap, blockWH };
