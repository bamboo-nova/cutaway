#!/usr/bin/env node
/* cutaway Layer 3: structure YAML (plugin-structure/v1.1) -> ELK -> .excalidraw
 *
 * Determinism: randomness/time are replaced by a seed hashed from the input YAML plus fixed values;
 * the same YAML always produces byte-identical output.
 * Usage: node convert.js <structure.yaml> [-o <out.excalidraw>] [--style <render-style.yaml>]
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const ELK = require("elkjs");
const elk = new ELK();

// ---- CLI ----
const argv = process.argv.slice(2);
function opt(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
}
const outArg = opt("-o") || opt("--out");
const styleArg = opt("--style");
const INPUT = argv[0];
if (!INPUT) {
  console.error("usage: node convert.js <structure.yaml> [-o out.excalidraw] [--style render-style.yaml]");
  process.exit(2);
}
const rawText = fs.readFileSync(INPUT, "utf8");
const spec = yaml.load(rawText);
if (!spec || spec.schema !== "plugin-structure/v1.1") {
  console.error(`error: schema must be plugin-structure/v1.1 (got: ${spec && spec.schema})`);
  process.exit(2);
}
const STYLE = yaml.load(fs.readFileSync(
  styleArg || path.resolve(__dirname, "../references/render-style.yaml"), "utf8"));
const OUT = outArg || path.join(path.dirname(INPUT), `${(spec.plugin && spec.plugin.name) || "plugin"}.excalidraw`);

const ROLE_COLOR = Object.assign({
  orchestrator: ["#6741d9", "#d0bfff"], gate: ["#e8590c", "#ffd8a8"],
  generator: ["#1971c2", "#a5d8ff"], agent: ["#0c8599", "#99e9f2"],
  mcp: ["#2f9e44", "#b2f2bb"], script: ["#9c36b5", "#eebefa"],
  data: ["#495057", "#f1f3f5"], user: ["#495057", "#e9ecef"],
  hook: ["#c92a2a", "#ffc9c9"],
}, STYLE.palette || {});
// chrome-string locale: the structure YAML's `lang` field decides (content is authored in that language too)
const lang = spec.lang === "en" ? "en" : "ja";
const LBL = (STYLE.labels || {})[lang] || {};
const VIS_LABEL = LBL.visibility || {};
const SPEC_LABEL = LBL.spec_status || {};
const DIALECT_LABEL = LBL.dialect || {};
const UI = LBL.ui || {};
const RB = lang === "en" ? ["[", "]"] : ["〔", "〕"];  // role/kind/actor brackets

// ---- deterministic RNG (mulberry32 seeded by the FNV-1a hash of the input YAML) ----
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const rand = (s => () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
})(fnv1a(rawText));
const NOW = 1;
let sc = 1000;
const rid = () => "el" + (sc++).toString(36);
const seed = () => Math.floor(rand() * 2 ** 31);

// ---- text width approximation and wrapping (unchanged from the convert5 prototype) ----
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

const elements = [];
const baseEl = (type, x, y, w, h, o = {}) => ({
  id: rid(), type, x, y, width: w, height: h, angle: 0,
  strokeColor: o.stroke || "#1e1e1e", backgroundColor: o.bg || "transparent",
  fillStyle: "solid", strokeWidth: o.sw ?? 2,
  strokeStyle: o.dash ? "dashed" : "solid", roughness: 1, opacity: 100,
  groupIds: [], frameId: null,
  roundness: type === "rectangle" ? { type: 3 } : (type === "arrow" ? { type: 2 } : null),
  seed: seed(), version: 1, versionNonce: seed(), isDeleted: false,
  boundElements: [], updated: NOW, link: null, locked: false,
});
function addText(x, y, text, o = {}) {
  const fsz = o.fs || 13;
  const lines = o.wrapped ? text.split("\n") : wrap(text, fsz, o.maxW || 10000);
  const joined = lines.join("\n");
  const [w, h] = blockWH(lines, fsz);
  const t = baseEl("text", x, y, w, h, { stroke: o.color || "#1e1e1e" });
  Object.assign(t, {
    text: joined, originalText: joined, fontSize: fsz, fontFamily: 2,
    textAlign: o.container ? "center" : "left",
    verticalAlign: o.container ? "middle" : "top",
    containerId: o.container ? o.container.id : null,
    lineHeight: 1.35, autoResize: false, baseline: h - 4, roundness: null,
  });
  if (o.container) {
    // Bound text must carry real container-centered coordinates (x:0,y:0 breaks initial rendering).
    t.x = o.container.x + (o.container.width - w) / 2;
    t.y = o.container.y + (o.container.height - h) / 2;
    t.autoResize = true;
    o.container.boundElements.push({ id: t.id, type: "text" });
  }
  elements.push(t);
  return t;
}
function chip(x, y, text, colors, o = {}) {
  const fsz = o.fs || 12;
  const lines = wrap(text, fsz, o.maxW || 300);
  const [tw, th] = blockWH(lines, fsz);
  const w = o.w || tw + 22, h = th + 14;
  const r = baseEl(o.shape || "rectangle", x, y, w, h,
    { stroke: colors[0], bg: colors[1], sw: 1.4, dash: o.dash });
  elements.push(r);
  addText(0, 0, lines.join("\n"), { container: r, fs: fsz, wrapped: true });
  return r;
}

// ---- the 9 inventory panels (visibility-driven) ----
const C = spec.components || {};
const sec = k => C[k] || { visibility: "not_visible", items: [] };
const items = k => (sec(k).items || []);

function skillChipText(s) {
  return `${s.id}\n${RB[0]}${s.role || UI.unclassified || "?"}${RB[1]}`;
}
function agentChips(section) {
  const list = section.items || [];
  const groups = section.groups || null;
  if (groups && groups.length) {
    const grouped = new Set(groups.flatMap(g => g.ids || []));
    const chips = groups.map(g => ({
      text: `${g.label}${(UI.group_count || "({n})").replace("{n}", String((g.ids || []).length))}`
        + `\n→ ${[...new Set((g.ids || []).flatMap(id => (list.find(a => a.id === id) || {}).used_by || []))].join(", ")}`
        + (g.note ? `\n${g.note}` : ""),
      colors: ROLE_COLOR.agent,
    }));
    for (const a of list.filter(a => !grouped.has(a.id))) {
      chips.push({ text: `${a.id}\n→ ${(a.used_by || []).join(", ")}${a.note ? "\n" + a.note : ""}`, colors: ROLE_COLOR.agent });
    }
    return chips;
  }
  const render = a => ({ text: `${a.id}\n→ ${(a.used_by || []).join(", ")}${a.note ? "\n" + a.note : ""}`, colors: ROLE_COLOR.agent });
  if (list.length > 12) {
    return [...list.slice(0, 10).map(render),
      { text: (UI.agents_more || "…{n}").replace("{n}", String(list.length - 10)), colors: ROLE_COLOR.agent }];
  }
  return list.map(render);
}
const PANEL_DEFS = [
  { key: "skills", base: "Skills", chips: s => (s.items || []).map(it => ({ text: skillChipText(it), colors: ROLE_COLOR[it.role] || ROLE_COLOR.generator })) },
  { key: "agents", base: "Agents", chips: agentChips },
  { key: "hooks", base: "Hooks", chips: s => (s.items || []).map(it => ({
      text: `${it.event}${it.matcher ? `（${it.matcher}）` : ""} → ${it.type}\n${it.command || ""}`,
      colors: ROLE_COLOR.hook })) },
  { key: "commands", base: "Commands", chips: s => (s.items || []).map(it => ({ text: `${it.id}\n${it.description || ""}`, colors: ROLE_COLOR.command })) },
  { key: "mcp_servers", base: "MCP servers", chips: s => (s.items || []).map(it => ({
      text: `${it.name}（${it.tools != null ? it.tools + (UI.tools_suffix || " tools") : (UI.tools_unknown || "?")}）`
        + (it.external ? (UI.external_tag || "") : "") + (it.note ? `\n${it.note}` : ""),
      colors: ROLE_COLOR.mcp })) },
  { key: "lsp_servers", base: "LSP servers", chips: s => (s.items || []).map(it => ({ text: `${it.name}${it.note ? "\n" + it.note : ""}`, colors: ROLE_COLOR.data })) },
  { key: "monitors", base: "Monitors", chips: s => (s.items || []).map(it => ({ text: `${it.name}${it.note ? "\n" + it.note : ""}`, colors: ROLE_COLOR.data })) },
  { key: "scripts", base: "Scripts", chips: s => (s.items || []).map(it => ({ text: `${it.file}${it.note ? "\n" + it.note : ""}`, colors: ROLE_COLOR.script })) },
  { key: "data_references", base: "Data / References", chips: s => (s.items || []).map(it => ({ text: `${it.file}${RB[0]}${it.kind}${RB[1]}${it.note ? "\n" + it.note : ""}`, colors: ROLE_COLOR.data })) },
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
const noneText = () => UI.none || "-";

(async () => {
  const MX = 60, MAX_ROW_W = 1980;
  // ---------- title, overview, legend ----------
  let hy = 26;
  addText(MX, hy, spec.title || "plugin structure map", { fs: 24 }); hy += 42;
  const dialectNote = DIALECT_LABEL[spec.dialect] || spec.dialect;
  if (dialectNote) { addText(MX, hy, (UI.dialect_prefix || "") + dialectNote, { fs: 11.5, color: "#868e96", maxW: 1900 }); hy += 22; }
  if (spec.plugin && spec.plugin.overview) {
    const ov = wrap((UI.overview_prefix || "") + spec.plugin.overview, 12.5, 1450);
    addText(MX, hy, ov.join("\n"), { fs: 12.5, color: "#343a40", wrapped: true });
    hy += ov.length * 17 + 8;
  }
  if (spec.note) { addText(MX, hy, spec.note, { fs: 11.5, color: "#868e96", maxW: 1450 }); hy += 26; }
  const LEGEND = LBL.legend || [];
  let lgx = MX;
  const legendPrefix = LBL.legend_prefix || "";
  addText(lgx, hy + 1, legendPrefix, { fs: 12, color: "#343a40" });
  lgx += lineW(legendPrefix, 12) + 14;
  for (const [k, name] of LEGEND) {
    const [st, bg] = ROLE_COLOR[k] || ROLE_COLOR.data;
    elements.push(baseEl("rectangle", lgx, hy, 24, 16, { stroke: st, bg, sw: 1.4 }));
    addText(lgx + 30, hy + 1, name, { fs: 11.5, color: "#495057" });
    lgx += 30 + lineW(name, 11.5) + 26;
  }
  if (LBL.legend_suffix) {
    const sep = lang === "en" ? "| " : "／ ";
    addText(lgx + 10, hy + 1, sep + LBL.legend_suffix, { fs: 11, color: "#868e96", maxW: 2100 - lgx });
  }
  hy += 32;

  // ---------- top: MECE inventory panels (9 panels, row wrapping) ----------
  const PAD = 14, HEAD = 30, CHIP_MAXW = 240;
  let rowTop = hy + 40, px = MX, invBottom = rowTop;
  addText(MX, rowTop - 24, UI.inventory_header || "Component inventory (MECE)", { fs: 15, color: "#343a40" });
  for (const def of PANEL_DEFS) {
    const section = sec(def.key);
    const title = panelTitle(def, section);
    const chipsSpec = def.chips(section);
    // Pre-measure chips to decide the panel's width/height.
    let cy = HEAD, maxW = lineW(title, 14) + 10;
    const placed = [];
    for (const it of chipsSpec) {
      const lines = wrap(it.text, 12, CHIP_MAXW);
      const [tw, th] = blockWH(lines, 12);
      placed.push({ it, h: th + 14, dy: cy });
      maxW = Math.max(maxW, tw + 22);
      cy += th + 14 + 8;
    }
    let noteLines = [];
    if (!chipsSpec.length) {
      noteLines = wrap(panelNote(section) || noneText(), 12, CHIP_MAXW);
      maxW = Math.max(maxW, blockWH(noteLines, 12)[0]);
      cy += blockWH(noteLines, 12)[1] + 10;
    }
    const pw = maxW + PAD * 2, ph = cy + PAD;
    if (px + pw > MX + MAX_ROW_W && px > MX) { px = MX; rowTop = invBottom + 40; }
    const panel = baseEl("rectangle", px, rowTop, pw, ph, { stroke: "#adb5bd", sw: 1, dash: true });
    elements.push(panel);
    addText(px + PAD, rowTop + 8, title, { fs: 14, color: "#343a40" });
    for (const pl of placed) chip(px + PAD, rowTop + pl.dy, pl.it.text, pl.it.colors, { maxW: CHIP_MAXW, w: maxW });
    if (!chipsSpec.length) addText(px + PAD, rowTop + HEAD + 4, noteLines.join("\n"), { fs: 12, color: "#868e96", wrapped: true });
    invBottom = Math.max(invBottom, rowTop + ph);
    px += pw + 26;
  }

  // ---------- middle: execution flow ----------
  const skills = items("skills");
  const findSkill = id => skills.find(s => s.id === id);
  const F = spec.flow;
  let cy2 = invBottom + 90;
  if (F && F.lanes && F.placement) {
    const FLOW_TOP = invBottom + 90;
    addText(MX, FLOW_TOP - 26, UI.flow_header || "Execution flow (skills layer)", { fs: 15, color: "#343a40" });
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
      return { kind, text: lines.join("\n"), w: gate ? tw + 110 : tw + 30, h: gate ? th + 66 : th + 22 };
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

    const offsets = {}; cy2 = FLOW_TOP + 40;
    for (const lane of F.lanes) { offsets[lane.id] = { x: MX, y: cy2 }; cy2 += laid[lane.id].height + 150; }

    const geo = {};
    const zoneBoxes = [];
    for (const lane of F.lanes) {
      const off = offsets[lane.id];
      for (const child of laid[lane.id].children) {
        const ns = nodeSpecs[child.id];
        const gate = (STYLE.shapes && STYLE.shapes[ns.kind]) === "diamond" || ns.kind === "gate";
        const [st, bg] = ROLE_COLOR[ns.kind] || ROLE_COLOR.data;
        const el = baseEl(gate ? "diamond" : "rectangle",
          off.x + child.x, off.y + child.y, child.width, child.height,
          { stroke: st, bg, dash: ns.kind === "data" });
        elements.push(el);
        addText(0, 0, ns.text, { container: el, fs: NFS, wrapped: true });
        geo[child.id] = { x: el.x, y: el.y, w: el.width, h: el.height, el };
      }
    }
    const mainLane = F.lanes[0].id;
    for (const z of F.zones || []) {
      const ms = F.placement.filter(n => n.lane === mainLane && n.col >= z.cols[0] && n.col <= z.cols[1]);
      if (!ms.length) continue;
      const gs = ms.map(m => geo[m.ref]); const pad = 22;
      const x0 = Math.min(...gs.map(g => g.x)) - pad, y0 = Math.min(...gs.map(g => g.y)) - pad - 26;
      const x1 = Math.max(...gs.map(g => g.x + g.w)) + pad;
      const y1 = offsets[mainLane].y + laid[mainLane].height + pad;
      const zr = baseEl("rectangle", x0, y0, x1 - x0, y1 - y0, { stroke: "#adb5bd", dash: true, sw: 1 });
      zoneBoxes.push(zr);
      addText(x0 + 10, y0 + 6, z.label, { fs: 12.5, color: "#868e96" });
    }
    for (const lane of F.lanes) {
      if (lane.style !== "isolation") continue;
      const off = offsets[lane.id], g = laid[lane.id], pad = 26;
      const zr = baseEl("rectangle", off.x - pad, off.y - pad - 26,
        Math.max(g.width, laid[mainLane].width) + pad * 2, g.height + pad * 2 + 26,
        { stroke: "#e03131", dash: true, sw: 1.5 });
      zoneBoxes.push(zr);
      addText(off.x - pad + 12, off.y - pad - 20, lane.label, { fs: 12.5, color: "#e03131", maxW: 1400 });
    }
    elements.unshift(...zoneBoxes);

    function drawArrow(pts, e) {
      const [sx, sy] = pts[0];
      const rel = pts.map(([px2, py2]) => [px2 - sx, py2 - sy]);
      const a = geo[e.from], b = geo[e.to];
      const dashed = e.type === "ref";
      const ar = baseEl("arrow", sx, sy,
        Math.max(...rel.map(p => p[0])) - Math.min(...rel.map(p => p[0])),
        Math.max(...rel.map(p => p[1])) - Math.min(...rel.map(p => p[1])),
        { stroke: dashed ? "#868e96" : "#343a40", sw: 1.2, dash: dashed });
      Object.assign(ar, { points: rel, lastCommittedPoint: null,
        startBinding: { elementId: a.el.id, focus: 0, gap: 2 },
        endBinding: { elementId: b.el.id, focus: 0, gap: 2 },
        startArrowhead: null, endArrowhead: "arrow", elbowed: false });
      a.el.boundElements.push({ id: ar.id, type: "arrow" });
      b.el.boundElements.push({ id: ar.id, type: "arrow" });
      elements.push(ar);
      if (e.label) {
        const p0 = pts[0], p1 = pts[1];
        addText((p0[0] + p1[0]) / 2 + 6, (p0[1] + p1[1]) / 2 - 18, e.label, { fs: 10.5, color: "#495057" });
      }
    }
    const laneOf = ref => (F.placement.find(n => n.ref === ref) || {}).lane;
    for (const lane of F.lanes) {
      const off = offsets[lane.id];
      for (const e of laid[lane.id].edges || []) {
        const s = e.sections[0];
        drawArrow([s.startPoint, ...(s.bendPoints || []), s.endPoint].map(p => [p.x + off.x, p.y + off.y]), e._spec);
      }
    }
    for (const e of F.edges || []) {
      if (laneOf(e.from) === laneOf(e.to)) continue;
      const a = geo[e.from], b = geo[e.to];
      const sx = a.x + a.w / 2, sy = a.y + a.h, tx = b.x + b.w / 2, ty = b.y;
      drawArrow([[sx, sy], [sx, ty - 55], [tx, ty - 55], [tx, ty]], e);
    }
  } else {
    addText(MX, invBottom + 64, UI.flow_undefined || "Execution flow: undefined (draft)", { fs: 15, color: "#adb5bd" });
    cy2 = invBottom + 190;
  }

  // ---------- bottom: example invocation (representative trace) ----------
  if (spec.example_trace) {
    const KC = { user: ROLE_COLOR.user, skill: ROLE_COLOR.generator,
                 orchestrator: ROLE_COLOR.orchestrator, agent: ROLE_COLOR.agent,
                 mcp: ROLE_COLOR.mcp, gate: ROLE_COLOR.gate, data: ROLE_COLOR.data,
                 script: ROLE_COLOR.script };
    let ty2 = cy2 - 90;
    addText(MX, ty2, UI.trace_header || "Example invocation (representative trace)", { fs: 15, color: "#343a40" });
    ty2 += 34;
    let prev = null, i = 1;
    for (const st of spec.example_trace) {
      const c = chip(MX + 22, ty2, `${i}. ${RB[0]}${st.actor}${RB[1]} ${st.text}`,
        KC[st.kind] || KC.skill, { maxW: 640, fs: 12 });
      if (prev) {
        const gap = ty2 - (prev.y + prev.height);
        const ar = baseEl("arrow", prev.x + 26, prev.y + prev.height, 0, gap, { stroke: "#868e96", sw: 1.1 });
        Object.assign(ar, { points: [[0, 0], [0, gap]], lastCommittedPoint: null,
          startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false });
        elements.push(ar);
      }
      prev = c; ty2 += c.height + 16; i++;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    type: "excalidraw", version: 2,
    source: "plugin-structure/v1.1 -> elk -> excalidraw",
    elements, appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {},
  }, null, 1));
  console.log(OUT, elements.length, "elements");
})();
