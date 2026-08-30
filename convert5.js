#!/usr/bin/env node
/* structure-v3.yaml -> [MECE inventory panels + ELK flow] -> .excalidraw */
const fs = require("fs");
const yaml = require("js-yaml");
const ELK = require("elkjs");
const elk = new ELK();

const spec = yaml.load(fs.readFileSync(process.argv[2] || "structure-v3.yaml", "utf8"));
let STYLE = {};
try { STYLE = yaml.load(fs.readFileSync(__dirname + "/render-style.yaml", "utf8")); } catch (e) {}
const OUT = process.argv[3] || "structure-v3.excalidraw";

const ROLE_COLOR = Object.assign({
  orchestrator: ["#6741d9", "#d0bfff"], gate: ["#e8590c", "#ffd8a8"],
  generator: ["#1971c2", "#a5d8ff"], importer: ["#1971c2", "#a5d8ff"],
  maintenance: ["#1971c2", "#a5d8ff"], inventory: ["#1971c2", "#a5d8ff"],
  data: ["#495057", "#f1f3f5"], agent: ["#0c8599", "#99e9f2"],
  mcp: ["#2f9e44", "#b2f2bb"], script: ["#9c36b5", "#eebefa"],
}, STYLE.palette || {});
const NOW = Date.now();
let sc = 1000;
const rid = () => "el" + (sc++).toString(36) + Math.random().toString(36).slice(2, 10);
const seed = () => Math.floor(Math.random() * 2 ** 31);

// ---- 文字幅の実測近似と折返し ----
const chW = (c, fs) => (c.charCodeAt(0) > 0x2000 ? fs * 1.02 : fs * 0.62);
const lineW = (l, fs) => [...l].reduce((a, c) => a + chW(c, fs), 0);
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
function wrap(text, fs, maxW) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    let line = "";
    for (const tok of tokenize(raw)) {
      if (lineW(line + tok, fs) > maxW && line.trim()) {
        out.push(line.trimEnd());
        line = tok === " " ? "" : tok;
      } else line += tok;
      while (lineW(line, fs) > maxW && line.length > 1) { // 単語自体が長すぎる場合のみ強制分割
        let cut = line.length - 1;
        while (cut > 1 && lineW(line.slice(0, cut), fs) > maxW) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
const blockWH = (lines, fs) =>
  [Math.ceil(Math.max(...lines.map(l => lineW(l, fs)))), Math.ceil(lines.length * fs * 1.35)];

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
    // バインドテキストはコンテナ中央の実座標で出力する（x:0,y:0 だと
    // Excalidraw が編集操作まで再配置せず、初期表示位置がずれる）
    t.x = o.container.x + (o.container.width - w) / 2;
    t.y = o.container.y + (o.container.height - h) / 2;
    t.autoResize = true;
    o.container.boundElements.push({ id: t.id, type: "text" });
  }
  elements.push(t);
  return t;
}
// チップ（小ノード）: 折返し済みテキストから箱サイズを決めるので、はみ出さない
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

(async () => {
  const MX = 60;
  // ---------- タイトル・概要 ----------
  let hy = 26;
  addText(MX, hy, spec.title, { fs: 24 }); hy += 42;
  if (spec.plugin && spec.plugin.overview) {
    const ov = wrap("概要: " + spec.plugin.overview, 12.5, 1450);
    addText(MX, hy, ov.join("\n"), { fs: 12.5, color: "#343a40", wrapped: true });
    hy += ov.length * 17 + 8;
  }
  if (spec.note) { addText(MX, hy, spec.note, { fs: 11.5, color: "#868e96", maxW: 1450 }); hy += 26; }
  const LEGEND = STYLE.legend || [["orchestrator", "オーケストレータ"], ["generator", "スキル"],
    ["gate", "ゲート/監査"], ["agent", "エージェント"], ["mcp", "MCPサーバー"],
    ["script", "スクリプト"], ["data", "データ/成果物"]];
  let lgx = MX;
  addText(lgx, hy + 1, "凡例:", { fs: 12, color: "#343a40" }); lgx += 48;
  for (const [k, jp] of LEGEND) {
    const [st, bg] = ROLE_COLOR[k] || ROLE_COLOR.data;
    elements.push(baseEl("rectangle", lgx, hy, 24, 16, { stroke: st, bg, sw: 1.4 }));
    addText(lgx + 30, hy + 1, jp, { fs: 11.5, color: "#495057" });
    lgx += 30 + lineW(jp, 11.5) + 26;
  }
  if (STYLE.legend_suffix) addText(lgx + 10, hy + 1, "／ " + STYLE.legend_suffix, { fs: 11, color: "#868e96", maxW: 1900 - lgx });
  hy += 32;

  // ---------- 上段: MECE 棚卸しパネル ----------
  const C = spec.components;
  const skills = C.skills || [];
  const findSkill = id => skills.find(s => s.id === id);
  const panels = [
    { title: `Skills（${skills.length}）`,
      items: skills.map(s => ({ text: `${s.id}\n〔${s.role}〕`, colors: ROLE_COLOR[s.role] || ROLE_COLOR.generator })) },
    { title: C.agents_label || `Agents（${(C.agents || []).length}）`,
      empty: C.agents_note,
      items: (C.agents || []).map(a => ({ text: `${a.id}\n→ ${(a.used_by || []).join(", ")}${a.note ? "\n" + a.note : ""}`, colors: ROLE_COLOR.agent })) },
    { title: C.hooks_label || `Hooks（${(C.hooks || []).length}）`, empty: C.hooks_note || "検出なし", items: [] },
    { title: C.commands_label || `Commands（${(C.commands || []).length}）`, empty: C.commands_note || "検出なし", items: [] },
    { title: `MCP servers（${(C.mcp_servers || []).length}）`,
      items: (C.mcp_servers || []).map(m => ({ text: `${m.name}（${m.tools} tools）\n${m.note || ""}`, colors: ROLE_COLOR.mcp })) },
    { title: `Scripts（${(C.scripts || []).length}）`,
      items: (C.scripts || []).map(s => ({ text: `${s.file}${s.note ? "\n" + s.note : ""}`, colors: ROLE_COLOR.script })) },
    { title: `Data / References（${(C.data_references || []).length}）`,
      items: (C.data_references || []).map(d => ({ text: `${d.file}〔${d.kind}〕`, colors: ROLE_COLOR.data })) },
  ];
  const P_TOP = hy + 40, PAD = 14, HEAD = 30, CHIP_MAXW = 240;
  let px = MX, invBottom = 0;
  addText(MX, P_TOP - 24, "■ コンポーネント棚卸し（MECE）", { fs: 15, color: "#343a40" });
  for (const p of panels) {
    // 先にチップサイズを見積もってパネル幅を決める
    let cy = P_TOP + HEAD, maxW = lineW(p.title, 14) + 10;
    const placed = [];
    for (const it of p.items) {
      const lines = wrap(it.text, 12, CHIP_MAXW);
      const [tw, th] = blockWH(lines, 12);
      placed.push({ it, w: tw + 22, h: th + 14, y: cy });
      maxW = Math.max(maxW, tw + 22);
      cy += th + 14 + 8;
    }
    if (!p.items.length) {
      const lines = wrap(p.empty || "検出なし", 12, CHIP_MAXW);
      maxW = Math.max(maxW, blockWH(lines, 12)[0]);
      cy += blockWH(lines, 12)[1] + 10;
    }
    const pw = maxW + PAD * 2, ph = cy - P_TOP + PAD;
    const panel = baseEl("rectangle", px, P_TOP, pw, ph, { stroke: "#adb5bd", sw: 1, dash: true });
    elements.push(panel);
    addText(px + PAD, P_TOP + 8, p.title, { fs: 14, color: "#343a40" });
    for (const pl of placed) chip(px + PAD, pl.y, pl.it.text, pl.it.colors, { maxW: CHIP_MAXW, w: maxW });
    if (!p.items.length) addText(px + PAD, P_TOP + HEAD + 4, p.empty || "検出なし", { fs: 12, color: "#868e96", maxW: CHIP_MAXW });
    invBottom = Math.max(invBottom, P_TOP + ph);
    px += pw + 26;
  }

  // ---------- 下段: 実行フロー ----------
  const FLOW_TOP = invBottom + 90;
  addText(MX, FLOW_TOP - 26, "■ 実行フロー（Skills レイヤー）", { fs: 15, color: "#343a40" });
  const F = spec.flow;
  const NODE_MAXW = 235, NFS = 12.5;

  function flowNodeSpec(p) {
    const s = findSkill(p.ref);
    const kind = p.kind || (s ? (s.role === "orchestrator" ? "orchestrator" : s.role === "gate" ? "gate" : "generator") : "data");
    const lines = [];
    const order = s && s.pipeline_order ? ["①", "②", "③"][s.pipeline_order - 1] + " " : "";
    lines.push(...wrap(order + p.ref, NFS, NODE_MAXW));
    const desc = p.desc || (s && s.description) || "";
    if (desc) lines.push(...wrap(desc, NFS, NODE_MAXW));
    if (s && s.uses) {
      const u = s.uses;
      if (u.mcp) lines.push(...wrap("MCP: " + Object.keys(u.mcp).join(" / "), NFS, NODE_MAXW));
      if (u.agents) lines.push(...wrap("Agent: " + u.agents.join(", "), NFS, NODE_MAXW));
      if (u.scripts) lines.push(...wrap("Script: " + u.scripts.join(", "), NFS, NODE_MAXW));
    }
    const [tw, th] = blockWH(lines, NFS);
    const gate = kind === "gate";
    return { kind, text: lines.join("\n"),
             w: gate ? tw + 110 : tw + 30, h: gate ? th + 66 : th + 22 };
  }

  const nodeSpecs = {};
  for (const p of F.placement) nodeSpecs[p.ref] = { ...flowNodeSpec(p), ...p };

  async function layoutLane(laneId) {
    const nodes = F.placement.filter(n => n.lane === laneId);
    const ids = new Set(nodes.map(n => n.ref));
    const edges = F.edges.filter(e => ids.has(e.from) && ids.has(e.to));
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

  const offsets = {}; let cy2 = FLOW_TOP + 40;
  for (const lane of F.lanes) { offsets[lane.id] = { x: MX, y: cy2 }; cy2 += laid[lane.id].height + 150; }

  const geo = {};
  const zoneBoxes = [];
  for (const lane of F.lanes) {
    const off = offsets[lane.id];
    for (const child of laid[lane.id].children) {
      const ns = nodeSpecs[child.id];
      const [st, bg] = ROLE_COLOR[ns.kind] || ROLE_COLOR.data;
      const el = baseEl(ns.kind === "gate" ? "diamond" : "rectangle",
        off.x + child.x, off.y + child.y, child.width, child.height,
        { stroke: st, bg, dash: ns.kind === "data" });
      elements.push(el);
      addText(0, 0, ns.text, { container: el, fs: NFS, wrapped: true });
      geo[child.id] = { x: el.x, y: el.y, w: el.width, h: el.height, el };
    }
  }
  for (const z of F.zones || []) {
    const ms = F.placement.filter(n => n.lane === "main" && n.col >= z.cols[0] && n.col <= z.cols[1]);
    if (!ms.length) continue;
    const gs = ms.map(m => geo[m.ref]); const pad = 22;
    const x0 = Math.min(...gs.map(g => g.x)) - pad, y0 = Math.min(...gs.map(g => g.y)) - pad - 26;
    const x1 = Math.max(...gs.map(g => g.x + g.w)) + pad;
    const y1 = offsets.main.y + laid.main.height + pad;
    const zr = baseEl("rectangle", x0, y0, x1 - x0, y1 - y0, { stroke: "#adb5bd", dash: true, sw: 1 });
    zoneBoxes.push(zr);
    addText(x0 + 10, y0 + 6, z.label, { fs: 12.5, color: "#868e96" });
  }
  for (const lane of F.lanes) {
    if (lane.style !== "isolation") continue;
    const off = offsets[lane.id], g = laid[lane.id], pad = 26;
    const zr = baseEl("rectangle", off.x - pad, off.y - pad - 26,
      Math.max(g.width, laid.main.width) + pad * 2, g.height + pad * 2 + 26,
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
  const laneOf = ref => F.placement.find(n => n.ref === ref).lane;
  for (const lane of F.lanes) {
    const off = offsets[lane.id];
    for (const e of laid[lane.id].edges || []) {
      const s = e.sections[0];
      drawArrow([s.startPoint, ...(s.bendPoints || []), s.endPoint].map(p => [p.x + off.x, p.y + off.y]), e._spec);
    }
  }
  for (const e of F.edges) {
    if (laneOf(e.from) === laneOf(e.to)) continue;
    const a = geo[e.from], b = geo[e.to];
    const sx = a.x + a.w / 2, sy = a.y + a.h, tx = b.x + b.w / 2, ty = b.y;
    drawArrow([[sx, sy], [sx, ty - 55], [tx, ty - 55], [tx, ty]], e);
  }

  // ---------- 呼び出し例（代表トレース） ----------
  if (spec.example_trace) {
    const KC = { user: ["#495057", "#e9ecef"], skill: ROLE_COLOR.generator,
                 orchestrator: ROLE_COLOR.orchestrator, agent: ROLE_COLOR.agent,
                 mcp: ROLE_COLOR.mcp, gate: ROLE_COLOR.gate, data: ROLE_COLOR.data };
    let ty2 = cy2 - 90;
    addText(MX, ty2, "■ 呼び出し例（代表トレース）", { fs: 15, color: "#343a40" });
    ty2 += 34;
    let prev = null, i = 1;
    for (const st of spec.example_trace) {
      const c = chip(MX + 22, ty2, `${i}. 〔${st.actor}〕 ${st.text}`,
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
    source: "plugin-structure/v1 -> elk -> excalidraw",
    elements, appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {},
  }, null, 1));
  console.log(OUT, elements.length, "elements");
})();
