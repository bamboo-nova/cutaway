---
name: visualize-plugin
description: >
  Inventory the full source of a Claude Code plugin or an Agent Plugins 1.0 plugin and
  deterministically generate a reviewable structure YAML (the canonical record) plus an
  Excalidraw structure map. Output is a 3-band canvas: (1) MECE component inventory across
  9 panels with explicit visibility, (2) execution flow (skills layer, ELK auto-layout),
  (3) a representative invocation trace. Structural changes review as YAML diffs.
  Works in English and Japanese at equal quality (structure YAML `lang` field).
  Triggers: "visualize plugin", "plugin structure", "structure map", "plugin diagram",
  「プラグインを可視化」「構成図を作って」「棚卸し図」「プラグイン構造」.
triggers: ["visualize plugin", "plugin structure", "structure map", "plugin diagram", "プラグインを可視化", "構成図を作って", "棚卸し図", "プラグイン構造"]
argument-hint: "<plugin-path> [--out <dir>] [--lang en|ja]"
allowedTools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - Edit
---

# visualize-plugin

Visualizes a plugin's structure through three layers: extract -> canonical YAML -> render.
**The same YAML always produces the same diagram** (deterministic converter; the LLM never
writes Excalidraw JSON directly).

## One-time setup

```bash
# Plugin-root env var: CLAUDE_PLUGIN_ROOT under Claude Code, PLUGIN_ROOT under Codex
cd "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/skills/visualize-plugin/scripts"
[ -d node_modules ] || npm ci   # installs elkjs / js-yaml from the lockfile (.npmrc enforces min-release-age=7)
```

Requires `node` (v18+) and `uv`. `scripts/` below refers to this directory.

## Language

Decide the output language first: use the language the user is working in, or their
explicit request. Pass `--lang en|ja` to extract; author ALL content strings (descriptions,
notes, flow labels, trace) in that language during draft completion. Chrome strings in the
figure (legend, panel titles, notes) switch automatically via the YAML's `lang` field —
both languages must come out at equal quality.

## Workflow

`<target>` is the target plugin path; `<out>` defaults to cutaway's `structures/`
and `out/` directories.

### Step 1: Extract (Layer 1 — deterministic)

```bash
uv run scripts/extract.py <target> -o <out>/structure-<name>.yaml --lang <en|ja>
```

- The dialect (claude-code / agent-plugins-1.0 / unknown) is auto-detected; see
  `references/agent-plugins-dialect.md`.
- Every item carries provenance / visibility. **Never confuse "zero" with "not visible"**
  (scanned-and-absent = verified_empty; source-not-mounted = not_visible).
- On claude.ai or anywhere only skills/ is mounted, add `--env claude-ai`: the output is a
  skillmd-mention lower bound and the figure says so.

### Step 2: Complete the draft (Layer 2 — the quality gate, Claude + human work)

Resolve every `# TODO(Claude):` following `references/extraction-checklist.md`:
assign roles -> confirm uses -> pipeline_order -> agents' used_by/groups -> design flow ->
write the trace. The exact schema is `references/structure-schema.md`.

When finished, **present the role list, grouping and trace summary to the user and get
confirmation before proceeding**.

### Step 3: Validate the canonical YAML

```bash
node scripts/validate.js --yaml <out>/structure-<name>.yaml
```

### Step 4: Convert (Layer 3 — deterministic)

```bash
node scripts/convert.js <out>/structure-<name>.yaml -o <out>/<name>.excalidraw
```

### Step 5: Validate the figure + determinism

```bash
node scripts/validate.js <out>/<name>.excalidraw
# determinism: re-convert and require byte-identical output
node scripts/convert.js <out>/structure-<name>.yaml -o /tmp/re.excalidraw && cmp <out>/<name>.excalidraw /tmp/re.excalidraw
```

### Step 6: Visual check (done by the user)

The user opens `out/<name>.excalidraw` at excalidraw.com (or a local Excalidraw) and
checks text overflow, node overlap, CJK rendering, and legend/zone placement.

- **Claude never injects local artifacts into a browser session** (no
  `browser_run_code_unsafe` or other sandbox-escaping execution, no pushing scenes to
  external origins — information-leak risk).
- When issues are reported, **fix the YAML** and rerun from Step 3 (never hand-edit the
  .excalidraw).

## Output conventions

- Canonical record: `structures/structure-<name>.yaml` (reviewable; structural change = this diff)
- Figure: `out/<name>.excalidraw` (open at excalidraw.com for manual polish)
- Three bands: (1) 9 inventory panels (Skills / Agents / Hooks / Commands / MCP servers /
  LSP servers / Monitors / Scripts / Data・References), (2) execution flow, (3) trace
- Wiring reduction: MCP / agent / script dependencies are in-node badges; edges are
  flow (solid) / ref (dashed) only.

## Constraints & cautions

- The YAML is canonical. Hand-edits to the figure are cosmetic only; structural changes
  always go back into the YAML.
- Flow lanes are linear: per-lane 0-based consecutive cols, one process per lane,
  at most one cross-lane flow edge, loops as `ref` back-edges (see structure-schema.md).
  `validate.js` enforces the col rule and reports arrow crossings / overlaps /
  node pass-through on the figure as warnings.
- No emoji in YAML strings (tofu risk in export fonts).
- Plugins with more than 12 agents get `groups` (true counts stay in panel titles).
- A missing plugin.json declaration does NOT mean a component is absent — default-path
  auto-discovery (hooks/hooks.json etc.) is authoritative; always dirscan.
- Test fixture for the agent-plugins-1.0 dialect: `assets/fixtures/hello-agent-plugin/`.
