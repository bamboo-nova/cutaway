#!/usr/bin/env node
/* cutaway Layer 3: structure YAML (plugin-structure/v1.1) -> ELK -> .excalidraw | .html
 *
 * The output format is chosen by the -o extension. Both emitters are deterministic:
 * the same YAML always produces byte-identical output (Excalidraw seeds come from a hash of the input;
 * the HTML emitter uses no randomness at all).
 * Usage: node convert.js <structure.yaml> [-o <out.excalidraw|out.html>] [--style <render-style.yaml>]
 */
const fs = require("fs");
const path = require("path");
const { buildModel } = require("./lib/model");
const emitExcalidraw = require("./emit/excalidraw");
const emitHtml = require("./emit/html");

const argv = process.argv.slice(2);
function opt(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
}
const outArg = opt("-o") || opt("--out");
const styleArg = opt("--style");
const INPUT = argv[0];
if (!INPUT) {
  console.error("usage: node convert.js <structure.yaml> [-o out.excalidraw|out.html] [--style render-style.yaml]");
  process.exit(2);
}

(async () => {
  let model;
  try { model = await buildModel(INPUT, styleArg); }
  catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  const OUT = outArg || path.join(path.dirname(INPUT), `${(model.spec.plugin && model.spec.plugin.name) || "plugin"}.excalidraw`);
  const ext = path.extname(OUT).toLowerCase();
  if (ext === ".excalidraw") {
    const { text, count } = emitExcalidraw(model);
    fs.writeFileSync(OUT, text);
    console.log(OUT, count, "elements");
  } else if (ext === ".html") {
    const text = emitHtml(model);
    fs.writeFileSync(OUT, text);
    console.log(OUT, Buffer.byteLength(text), "bytes");
  } else {
    console.error(`error: unsupported output extension "${ext}" (use .excalidraw or .html)`);
    process.exit(2);
  }
})();
