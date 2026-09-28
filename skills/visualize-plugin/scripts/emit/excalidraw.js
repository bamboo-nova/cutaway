/* cutaway Layer 3 emitter: Model -> .excalidraw JSON.
 * Determinism: randomness/time are replaced by a seed hashed from the input YAML plus fixed values;
 * the same Model (built from the same YAML) always produces byte-identical output. */
const { wrap, lineW, blockWH } = require("../lib/model");

module.exports = function emitExcalidraw(model) {
  const { ROLE_COLOR, lang, UI, RB } = model.ctx;

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
  })(fnv1a(model.rawText));
  const NOW = 1;
  let sc = 1000;
  const rid = () => "el" + (sc++).toString(36);
  const seed = () => Math.floor(rand() * 2 ** 31);

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

  const MX = 60, MAX_ROW_W = 1980;
  // ---------- title, overview, legend ----------
  const hdr = model.header;
  let hy = 26;
  addText(MX, hy, hdr.title, { fs: 24 }); hy += 42;
  if (hdr.dialectNote) { addText(MX, hy, (UI.dialect_prefix || "") + hdr.dialectNote, { fs: 11.5, color: "#868e96", maxW: 1900 }); hy += 22; }
  if (hdr.overview) {
    const ov = wrap((UI.overview_prefix || "") + hdr.overview, 12.5, 1450);
    addText(MX, hy, ov.join("\n"), { fs: 12.5, color: "#343a40", wrapped: true });
    hy += ov.length * 17 + 8;
  }
  if (hdr.note) { addText(MX, hy, hdr.note, { fs: 11.5, color: "#868e96", maxW: 1450 }); hy += 26; }
  let lgx = MX;
  addText(lgx, hy + 1, hdr.legendPrefix, { fs: 12, color: "#343a40" });
  lgx += lineW(hdr.legendPrefix, 12) + 14;
  for (const [k, name] of hdr.legend) {
    const [st, bg] = ROLE_COLOR[k] || ROLE_COLOR.data;
    elements.push(baseEl("rectangle", lgx, hy, 24, 16, { stroke: st, bg, sw: 1.4 }));
    addText(lgx + 30, hy + 1, name, { fs: 11.5, color: "#495057" });
    lgx += 30 + lineW(name, 11.5) + 26;
  }
  if (hdr.legendSuffix) {
    const sep = lang === "en" ? "| " : "／ ";
    addText(lgx + 10, hy + 1, sep + hdr.legendSuffix, { fs: 11, color: "#868e96", maxW: 2100 - lgx });
  }
  hy += 32;

  // ---------- top: MECE inventory panels (9 panels, row wrapping) ----------
  const PAD = 14, HEAD = 30, CHIP_MAXW = 240;
  let rowTop = hy + 40, px = MX, invBottom = rowTop;
  addText(MX, rowTop - 24, UI.inventory_header || "Component inventory (MECE)", { fs: 15, color: "#343a40" });
  for (const p of model.panels) {
    const title = p.title;
    const chipsSpec = p.chips;
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
      noteLines = wrap(p.note, 12, CHIP_MAXW);
      maxW = Math.max(maxW, blockWH(noteLines, 12)[0]);
      cy += blockWH(noteLines, 12)[1] + 10;
    }
    const pw = maxW + PAD * 2, ph = cy + PAD;
    if (px + pw > MX + MAX_ROW_W && px > MX) { px = MX; rowTop = invBottom + 40; }
    const panel = baseEl("rectangle", px, rowTop, pw, ph, { stroke: "#adb5bd", sw: 1, dash: true });
    elements.push(panel);
    addText(px + PAD, rowTop + 8, title, { fs: 14, color: "#343a40" });
    for (const pl of placed) chip(px + PAD, rowTop + pl.dy, pl.it.text, ROLE_COLOR[pl.it.role], { maxW: CHIP_MAXW, w: maxW });
    if (!chipsSpec.length) addText(px + PAD, rowTop + HEAD + 4, noteLines.join("\n"), { fs: 12, color: "#868e96", wrapped: true });
    invBottom = Math.max(invBottom, rowTop + ph);
    px += pw + 26;
  }

  // ---------- middle: execution flow ----------
  let cy2 = invBottom + 90;
  if (model.flow) {
    const { F, nodeSpecs, laid, mainLane, NFS } = model.flow;
    const FLOW_TOP = invBottom + 90;
    addText(MX, FLOW_TOP - 26, UI.flow_header || "Execution flow (skills layer)", { fs: 15, color: "#343a40" });

    const offsets = {}; cy2 = FLOW_TOP + 40;
    for (const lane of F.lanes) { offsets[lane.id] = { x: MX, y: cy2 }; cy2 += laid[lane.id].height + 150; }

    const geo = {};
    const zoneBoxes = [];
    for (const lane of F.lanes) {
      const off = offsets[lane.id];
      for (const child of laid[lane.id].children) {
        const ns = nodeSpecs[child.id];
        const [st, bg] = ROLE_COLOR[ns.kind] || ROLE_COLOR.data;
        const el = baseEl(ns.gate ? "diamond" : "rectangle",
          off.x + child.x, off.y + child.y, child.width, child.height,
          { stroke: st, bg, dash: ns.kind === "data" });
        elements.push(el);
        addText(0, 0, ns.text, { container: el, fs: NFS, wrapped: true });
        geo[child.id] = { x: el.x, y: el.y, w: el.width, h: el.height, el };
      }
    }
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
  if (model.traces) {
    let ty2 = cy2 - 90;
    addText(MX, ty2, UI.trace_header || "Example invocation (representative trace)", { fs: 15, color: "#343a40" });
    ty2 += 34;
    // Several scenarios are stacked, each under its label (and summary). The single
    // `example_trace` shorthand has no label and renders exactly as before.
    for (const sc of model.traces) {
      if (sc.label) {
        const t = addText(MX + 22, ty2, sc.label + (sc.summary ? `\n${sc.summary}` : ""), { fs: 13, color: "#343a40", maxW: 640 });
        ty2 += t.height + 12;
      }
      let prev = null;
      for (const st of sc.steps) {
        const c = chip(MX + 22, ty2, `${st.n}. ${RB[0]}${st.actor}${RB[1]} ${st.text}`,
          ROLE_COLOR[st.role], { maxW: 640, fs: 12 });
        if (prev) {
          const gap = ty2 - (prev.y + prev.height);
          const ar = baseEl("arrow", prev.x + 26, prev.y + prev.height, 0, gap, { stroke: "#868e96", sw: 1.1 });
          Object.assign(ar, { points: [[0, 0], [0, gap]], lastCommittedPoint: null,
            startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false });
          elements.push(ar);
        }
        prev = c; ty2 += c.height + 16;
      }
      if (sc.label) ty2 += 14;
    }
  }

  return {
    text: JSON.stringify({
      type: "excalidraw", version: 2,
      source: "plugin-structure/v1.1 -> elk -> excalidraw",
      elements, appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {},
    }, null, 1),
    count: elements.length,
  };
};
