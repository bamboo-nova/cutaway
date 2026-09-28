#!/usr/bin/env node
/* cutaway regression test  (run: npm test  /  node test.js)
 * Golden = docs/examples/{en,ja}: every structure-*.yaml must reproduce the committed figures byte-for-byte.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");
const EX = path.join(ROOT, "docs/examples");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cutaway-test-"));
let failed = 0;
const ok = m => console.log("ok  " + m);
const ng = m => { failed++; console.log("NG  " + m); };
const run = (script, args) =>
  spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: "utf8" });
const convert = (yamlFile, out) => {
  const r = run("convert.js", [yamlFile, "-o", out]);
  if (r.status !== 0) throw new Error(r.stderr.trim() || `exit ${r.status}`);
  return fs.readFileSync(out);
};

const cases = [];
for (const lang of ["en", "ja"]) {
  const dir = path.join(EX, lang);
  for (const f of fs.readdirSync(dir).filter(n => n.startsWith("structure-") && n.endsWith(".yaml")).sort()) {
    cases.push({ lang, yaml: path.join(dir, f), name: f.slice("structure-".length, -".yaml".length) });
  }
}

for (const c of cases) {
  const label = `${c.lang}/${c.name}`;
  try {
    const got = convert(c.yaml, path.join(TMP, `${c.lang}-${c.name}.excalidraw`));
    const golden = fs.readFileSync(path.join(EX, c.lang, `${c.name}.excalidraw`));
    got.equals(golden) ? ok(`${label}: excalidraw byte-identical to golden`)
                       : ng(`${label}: excalidraw differs from docs/examples golden`);
  } catch (e) { ng(`${label}: excalidraw conversion failed: ${e.message}`); }

  try {
    const h1 = path.join(TMP, `${c.lang}-${c.name}.html`);
    const a = convert(c.yaml, h1);
    const b = convert(c.yaml, path.join(TMP, `${c.lang}-${c.name}.2.html`));
    a.equals(b) ? ok(`${label}: html deterministic`) : ng(`${label}: html not deterministic`);
    const v = run("validate.js", [h1, "--yaml-source", c.yaml]);
    v.status === 0 ? ok(`${label}: validate html`) : ng(`${label}: validate html failed\n${v.stderr}`);
    const goldenHtml = path.join(EX, c.lang, `${c.name}.html`);
    if (fs.existsSync(goldenHtml)) {
      a.equals(fs.readFileSync(goldenHtml)) ? ok(`${label}: html byte-identical to docs/examples`)
                                            : ng(`${label}: html differs from docs/examples (regenerate the example)`);
    }
  } catch (e) { ng(`${label}: html failed: ${e.message}`); }
}

// ---- minimal fixture: flow:null, no trace, HTML-special characters ----
const MIN = path.join(__dirname, "test/fixtures/minimal-noflow.yaml");
for (const ext of ["excalidraw", "html"]) {
  try { convert(MIN, path.join(TMP, `minimal.${ext}`)); ok(`minimal-noflow -> .${ext}`); }
  catch (e) { ng(`minimal-noflow -> .${ext}: ${e.message}`); }
}
{
  const html = fs.existsSync(path.join(TMP, "minimal.html")) ? fs.readFileSync(path.join(TMP, "minimal.html"), "utf8") : "";
  (!/<b>markup/.test(html) && !/<hello>/.test(html) && html.includes("&lt;b&gt;markup&lt;/b&gt; &amp; &quot;quotes&quot;"))
    ? ok("minimal-noflow: yaml text is html-escaped")
    : ng("minimal-noflow: yaml text is NOT html-escaped");
  html.includes('data-panel="data_references"') && !html.includes('<svg data-flow')
    ? ok("minimal-noflow: draft banner without svg, panels present")
    : ng("minimal-noflow: expected no <svg data-flow> and all panels");
}
{
  const v = run("validate.js", [path.join(TMP, "minimal.html"), "--yaml-source", MIN]);
  v.status === 0 ? ok("minimal-noflow: validate html") : ng(`minimal-noflow: validate html failed\n${v.stderr}`);
}
// ---- negative: external resources must be rejected ----
{
  const bad = path.join(TMP, "bad.html");
  fs.writeFileSync(bad, '<!doctype html><html><head><script src="https://example.com/x.js"></script></head><body></body></html>');
  const v = run("validate.js", [bad]);
  (v.status === 1 && /external script/.test(v.stderr)) ? ok("validate rejects external script")
    : ng(`validate did not reject external script (exit ${v.status})`);
}
{
  const bad = path.join(TMP, "bad2.html");
  fs.writeFileSync(bad, '<!doctype html><html><head><style>@import url("https://example.com/x.css");</style></head><body><script>fetch("https://example.com")</script></body></html>');
  const v = run("validate.js", [bad]);
  (v.status === 1 && /css @import/.test(v.stderr) && /network API/.test(v.stderr)) ? ok("validate rejects @import and fetch()")
    : ng(`validate did not reject @import/fetch (exit ${v.status})\n${v.stderr}`);
}
{
  const v = run("validate.js", [path.join(TMP, "minimal.html"), "--yaml-source", path.join(TMP, "does-not-exist.yaml")]);
  (v.status === 1 && /yaml-source/.test(v.stderr) && !/at .*validate\.js:\d+/.test(v.stderr))
    ? ok("validate reports a missing --yaml-source as NG (no stack trace)")
    : ng(`validate did not handle a missing --yaml-source cleanly (exit ${v.status})\n${v.stderr}`);
}
// ---- unsupported extension ----
{
  const out = path.join(TMP, "x.svg");
  const r = run("convert.js", [MIN, "-o", out]);
  (r.status === 2 && /unsupported output extension/.test(r.stderr) && !fs.existsSync(out))
    ? ok("unsupported extension exits 2 without writing")
    : ng(`unsupported extension: exit ${r.status}, stderr=${r.stderr.trim()}`);
}

// ---- empty-lane fixture: a lane with no placed nodes must not produce NaN geometry ----
{
  const EMPTY_LANE = path.join(__dirname, "test/fixtures/empty-lane.yaml");
  const outs = {};
  let converted = true;
  for (const ext of ["excalidraw", "html"]) {
    try { outs[ext] = path.join(TMP, `empty-lane.${ext}`); convert(EMPTY_LANE, outs[ext]); }
    catch (e) { converted = false; ng(`empty-lane -> .${ext}: ${e.message}`); }
  }
  if (converted) {
    ok("empty-lane: converts to both formats");
    const html = fs.readFileSync(outs.html, "utf8");
    const m = html.match(/<svg data-flow[^>]*\sviewBox="([^"]*)"/);
    (m && /^0 0 \d+(\.\d+)? \d+(\.\d+)?$/.test(m[1]))
      ? ok("empty-lane: viewBox has no NaN")
      : ng(`empty-lane: viewBox missing or invalid: ${m && m[1]}`);
    const v = run("validate.js", [outs.html, "--yaml-source", EMPTY_LANE]);
    v.status === 0 ? ok("empty-lane: validate html") : ng(`empty-lane: validate html failed\n${v.stderr}`);
  }
}

// ---- --style passthrough: validate.js must re-convert with the same render-style ----
{
  const styleCopy = path.join(TMP, "style-copy.yaml");
  fs.copyFileSync(path.join(__dirname, "../references/render-style.yaml"), styleCopy);
  const styled = path.join(TMP, "styled.html");
  const c1 = run("convert.js", [MIN, "--style", styleCopy, "-o", styled]);
  if (c1.status !== 0) {
    ng(`style passthrough: initial convert failed: ${c1.stderr.trim()}`);
  } else {
    const v1 = run("validate.js", [styled, "--yaml-source", MIN, "--style", styleCopy]);
    v1.status === 0 ? ok("style passthrough: validate with matching --style passes")
      : ng(`style passthrough: validate with matching --style failed\n${v1.stderr}`);

    // Prove the flag is actually forwarded: edit the style copy, re-convert with it,
    // then validation must only pass when the same --style is given back.
    const css = fs.readFileSync(styleCopy, "utf8").replace(
      'theme_toggle: "Toggle theme"', 'theme_toggle: "Theme?"');
    fs.writeFileSync(styleCopy, css);
    const c2 = run("convert.js", [MIN, "--style", styleCopy, "-o", styled]);
    if (c2.status !== 0) {
      ng(`style passthrough: re-convert with edited style failed: ${c2.stderr.trim()}`);
    } else {
      const withStyle = run("validate.js", [styled, "--yaml-source", MIN, "--style", styleCopy]);
      withStyle.status === 0 ? ok("style passthrough: validate with edited --style passes")
        : ng(`style passthrough: validate with edited --style failed\n${withStyle.stderr}`);
      const withoutStyle = run("validate.js", [styled, "--yaml-source", MIN]);
      (withoutStyle.status === 1 && /determinism/.test(withoutStyle.stderr))
        ? ok("style passthrough: validate without --style fails determinism")
        : ng(`style passthrough: validate without --style should fail determinism (exit ${withoutStyle.status})\n${withoutStyle.stderr}`);
    }
  }
}

// ---- trace line breaks: multiline example_trace text must render as <br>, not be flattened ----
{
  const TRACE_ML = path.join(__dirname, "test/fixtures/trace-multiline.yaml");
  const out = path.join(TMP, "trace-multiline.html");
  try {
    convert(TRACE_ML, out);
    const html = fs.readFileSync(out, "utf8");
    html.includes("line one<br>line two")
      ? ok("trace-multiline: newline rendered as <br>")
      : ng("trace-multiline: expected 'line one<br>line two' in output");
    const v = run("validate.js", [out, "--yaml-source", TRACE_ML]);
    v.status === 0 ? ok("trace-multiline: validate html") : ng(`trace-multiline: validate html failed\n${v.stderr}`);
  } catch (e) { ng(`trace-multiline: convert failed: ${e.message}`); }
}

// ---- html trace-path markup: path nodes/edges highlighted, tokens on path edges only ----
{
  const TN = path.join(__dirname, "test/fixtures/trace-nodes.yaml");
  const out = path.join(TMP, "trace-nodes.html");
  try {
    const html = convert(TN, out).toString("utf8");
    const checks = [
      ['<li data-step="1">', "step 1 has no data-node"],
      ['<li data-step="2" data-node="input">', "step 2 explicit node"],
      ['<li data-step="4" data-node="alpha">', "step 4 inherits alpha"],
      ['id="fe-0"', "edge ids"],
      ['<g class="tokens">', "ambient token group"],
      ['<animateMotion', "SMIL motion"],
      ['id="motion"', "motion toggle"],
      ['id="reset"', "reset button"],
      ['class="edge on-path"', "on-path edge"],
      ['kind-data on-path" data-ref="input"', "on-path node"],
    ];
    const missing = checks.filter(([needle]) => !html.includes(needle)).map(([, what]) => what);
    missing.length === 0 ? ok("trace-nodes: trace-path markup present") : ng(`trace-nodes: missing ${missing.join(", ")}`);
    const gone = ['id="play"', 'id="speed"', 'class="caption"', 'class="runner"'].filter(n => html.includes(n));
    if (/class="(node [^"]*|edge[^"]*|edge-label[^"]*)off-path"/.test(html)) gone.push("off-path markup");
    gone.length === 0 ? ok("trace-nodes: no playback controls, nothing off-path (all nodes on the trace)")
                      : ng(`trace-nodes: unexpected markup: ${gone.join(", ")}`);
    (html.match(/<animateMotion/g) || []).length === 3
      ? ok("trace-nodes: one ambient token per path edge (3)")
      : ng(`trace-nodes: expected 3 animateMotion, got ${(html.match(/<animateMotion/g) || []).length}`);
    const again = convert(TN, path.join(TMP, "trace-nodes.2.html")).toString("utf8");
    again === html ? ok("trace-nodes: html deterministic") : ng("trace-nodes: html not deterministic");
  } catch (e) { ng(`trace-nodes html: ${e.message}`); }
}
{
  const NE = path.join(__dirname, "test/fixtures/trace-no-edge.yaml");
  try {
    const html = convert(NE, path.join(TMP, "trace-no-edge.html")).toString("utf8");
    (html.match(/<animateMotion/g) || []).length === 2
      ? ok("trace-no-edge: converts; 2 ambient tokens (only the two direct path edges)")
      : ng("trace-no-edge: unexpected token count");
  } catch (e) { ng(`trace-no-edge html: ${e.message}`); }
}
{
  // trace-partial: the trace visits input -> alpha only; beta/output and their edges are drawn off-path.
  const TP = path.join(__dirname, "test/fixtures/trace-partial.yaml");
  try {
    const html = convert(TP, path.join(TMP, "trace-partial.html")).toString("utf8");
    const offNodes = (html.match(/<g class="node [^"]*off-path"/g) || []).length;
    const onNodes = (html.match(/<g class="node [^"]*on-path"/g) || []).length;
    const offEdges = (html.match(/class="edge off-path"/g) || []).length;
    const tokens = (html.match(/<animateMotion/g) || []).length;
    (offNodes === 2 && onNodes === 2 && offEdges === 2 && tokens === 1)
      ? ok("trace-partial: 2 nodes + 2 edges off-path, 1 token on the path edge")
      : ng(`trace-partial: offNodes=${offNodes} onNodes=${onNodes} offEdges=${offEdges} tokens=${tokens}`);
    const v = run("validate.js", [path.join(TMP, "trace-partial.html"), "--yaml-source", TP]);
    v.status === 0 ? ok("trace-partial: validate html") : ng(`trace-partial: validate html failed\n${v.stderr}`);
  } catch (e) { ng(`trace-partial html: ${e.message}`); }
}
{
  // no trace at all: nothing is dimmed and tokens run on every solid edge
  const EL = path.join(__dirname, "test/fixtures/empty-lane.yaml");
  try {
    const html = convert(EL, path.join(TMP, "empty-lane-path.html")).toString("utf8");
    (!/class="[^"]*(off|on)-path"/.test(html))
      ? ok("empty-lane: no trace -> no path classes")
      : ng("empty-lane: unexpected path classes without a trace");
  } catch (e) { ng(`empty-lane path check: ${e.message}`); }
}
{
  // trace-scenarios: two usage patterns; the first decides the initial classes, both are selectable.
  const TS = path.join(__dirname, "test/fixtures/trace-scenarios.yaml");
  try {
    const out = path.join(TMP, "trace-scenarios.html");
    const html = convert(TS, out).toString("utf8");
    const checks = [
      ['<button class="scn" type="button" data-scn="full" aria-pressed="true">Full run</button>', "first scenario button pressed"],
      ['<button class="scn" type="button" data-scn="dry" aria-pressed="false">Dry run</button>', "second scenario button"],
      ['<p class="scn-summary" data-scn="full">The usual path', "first summary visible"],
      ['<p class="scn-summary" data-scn="dry" hidden>', "second summary hidden"],
      ['<section class="scenario active" data-scn="full">', "first band-3 section active"],
      ['<section class="scenario" data-scn="dry">', "second band-3 section"],
      ['kind-artifact on-path" data-ref="output" data-paths="full">', "output only on the full path"],
      ['kind-data on-path" data-ref="input" data-paths="full dry">', "input on both paths"],
      ['data-from="beta" data-to="output" data-paths="full"', "beta->output edge only on full"],
    ];
    const missing = checks.filter(([needle]) => !html.includes(needle)).map(([, what]) => what);
    missing.length === 0 ? ok("trace-scenarios: selector, summaries, sections and data-paths present") : ng(`trace-scenarios: missing ${missing.join(", ")}`);
    const steps = (html.match(/<li data-step="/g) || []).length;
    steps === 7 ? ok("trace-scenarios: 7 steps across two scenarios") : ng(`trace-scenarios: expected 7 li, got ${steps}`);
    const tokens = (html.match(/<circle class="token[^"]*"/g) || []);
    (tokens.length === 3 && tokens.filter(t => t.includes(" off")).length === 0)
      ? ok("trace-scenarios: 3 tokens, none off for the first scenario (all edges on the full path)")
      : ng(`trace-scenarios: tokens=${tokens.length} off=${tokens.filter(t => t.includes(" off")).length}`);
    const v = run("validate.js", [out, "--yaml-source", TS]);
    v.status === 0 ? ok("trace-scenarios: validate html") : ng(`trace-scenarios: validate html failed\n${v.stderr}`);
    const y = run("validate.js", ["--yaml", TS]);
    (y.status === 0 && !/example_trace/.test(y.stderr)) ? ok("trace-scenarios: validate --yaml") : ng(`trace-scenarios: validate --yaml exit ${y.status}\n${y.stderr}`);
    const ex = convert(TS, path.join(TMP, "trace-scenarios.excalidraw")).toString("utf8");
    (ex.includes("Full run") && ex.includes("Dry run")) ? ok("trace-scenarios: excalidraw stacks both scenarios with labels")
      : ng("trace-scenarios: excalidraw output lacks scenario labels");
  } catch (e) { ng(`trace-scenarios: ${e.message}`); }
  const dup = run("validate.js", ["--yaml", path.join(__dirname, "test/fixtures/trace-scenarios-dup.yaml")]);
  (dup.status === 1 && /duplicate id: full/.test(dup.stderr)) ? ok("validate --yaml rejects duplicate scenario ids")
    : ng(`validate --yaml did not reject duplicate scenario id (exit ${dup.status})\n${dup.stderr}`);
}
{
  const TN = path.join(__dirname, "test/fixtures/trace-nodes.yaml");
  const v = run("validate.js", [path.join(TMP, "trace-nodes.html"), "--yaml-source", TN]);
  v.status === 0 ? ok("trace-nodes: validate html") : ng(`trace-nodes: validate html failed\n${v.stderr}`);
  const bad = path.join(TMP, "bad-steps.html");
  const html = fs.readFileSync(path.join(TMP, "trace-nodes.html"), "utf8")
    .replace('<li data-step="4" data-node="alpha">', '<li data-step="4" data-node="ghost">')
    .replace(/<li data-step="6"[^>]*>/, "<li>");
  fs.writeFileSync(bad, html);
  const w = run("validate.js", [bad, "--yaml-source", TN]);
  (w.status === 1 && /coverage\.step-node/.test(w.stderr) && /ghost/.test(w.stderr) && /coverage\.step/.test(w.stderr))
    ? ok("validate html rejects unresolved data-node and wrong step count")
    : ng(`validate html did not reject bad steps (exit ${w.status})\n${w.stderr}`);
}

// ---- trace-nodes: step -> node resolution (explicit node, actor match, inherit, unresolved head) ----
{
  const TN = path.join(__dirname, "test/fixtures/trace-nodes.yaml");
  const { buildModel } = require("./lib/model");
  buildModel(TN).then(m => {
    const got = m.trace.map(s => s.node);
    const want = [null, "input", "alpha", "alpha", "beta", "output"];
    JSON.stringify(got) === JSON.stringify(want)
      ? ok("trace-nodes: step nodes resolve (explicit / actor / inherit / unresolved head)")
      : ng(`trace-nodes: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }).catch(e => ng(`trace-nodes: buildModel failed: ${e.message}`)).finally(finish);
}
{
  const v = run("validate.js", ["--yaml", path.join(__dirname, "test/fixtures/trace-bad-node.yaml")]);
  (v.status === 1 && /example_trace\[1\]\.node/.test(v.stderr) && /nowhere/.test(v.stderr))
    ? ok("validate --yaml rejects a trace node that is not in flow.placement")
    : ng(`validate --yaml did not reject the bad trace node (exit ${v.status})\n${v.stderr}`);
}
{
  const v = run("validate.js", ["--yaml", path.join(__dirname, "test/fixtures/trace-nodes.yaml")]);
  (v.status === 0 && !/example_trace/.test(v.stderr))
    ? ok("validate --yaml accepts trace-nodes fixture without trace warnings")
    : ng(`validate --yaml on trace-nodes: exit ${v.status}\n${v.stderr}`);
}

function finish() {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `${failed} failure(s)` : "all passed");
  process.exit(failed ? 1 : 0);
}
