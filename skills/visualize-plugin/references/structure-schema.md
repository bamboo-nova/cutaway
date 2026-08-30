# plugin-structure/v1.1 schema

The structure YAML is the **canonical inventory**. extract.py generates a draft,
Claude/a human completes it, convert.js renders it and validate.js checks it.
**A structural change IS a diff of this YAML** — that is what gets reviewed.

Vocabulary (classes, relations, roles, provenance, visibility, dialects) is defined
in `plugin-ontology.yaml`.

## Top level

```yaml
schema: plugin-structure/v1.1        # required; convert/validate assert this value
ontology: claude-plugin/v1           # required
dialect: claude-code                 # required: claude-code | agent-plugins-1.0 | unknown
lang: en                             # content language: en | ja. Chrome strings in the
                                     # rendered figure follow this (render-style labels).
title: "<plugin> plugin structure map"
generated:                           # written by extract.py (do not hand-edit)
  by: extract.py/1.1
  at: "2026-08-30T00:00:00Z"         # extraction time (not rendered; no effect on determinism)
  environment: claude-code-dirscan   # claude-code-dirscan | claude-ai-skillmd
  source_root: /abs/path/to/plugin   # ALWAYS check this is the source you intended
plugin:
  name: meiseki
  version: 0.5.0                     # from the manifest; null if absent
  overview: "one-sentence overview"  # seeded from manifest description; Claude may refine
note: null                           # header caveat for the figure; null if none
```

**Language rule**: every content string (descriptions, notes, flow labels, trace text)
is authored in the language declared by `lang`, consistently. Both languages must reach
the same quality — same information density, same honesty about provenance/visibility.
Do not mix languages inside one file except for proper nouns and identifiers.

## components — 9 sections (MECE inventory)

Always exactly nine sections: `skills` / `agents` / `hooks` / `commands` / `mcp_servers` /
`lsp_servers` / `monitors` / `scripts` / `data_references`.
**Never omit an absent category** — declare it with `visibility: verified_empty`
(never confuse "zero" with "not visible").

Common wrapper per section:

```yaml
components:
  <section>:
    visibility: verified             # verified | verified_empty | not_visible
    provenance: dirscan              # section default (items may override)
    spec_status: in-spec             # optional; out-of-spec for entities outside the
                                     # agent-plugins-1.0 standard scope
    note: null                       # extra note rendered inside the panel
    items: [...]                     # empty list when verified_empty / not_visible
```

### Item shapes per section

```yaml
skills:
  items:
    - id: collect-sources            # directory name under skills/<id>/
      role: orchestrator             # required (from ontology skill_roles); extract leaves null + TODO
      description: "one line"
      pipeline_order: 1              # order in a serial orchestration (numbered badge); null if n/a
      binds_agent: web-collector     # from `agent:` frontmatter, if present
      context: fork                  # from `context:` frontmatter, if present
      argument_hint: "<path>"        # from argument-hint frontmatter, if present
      uses:                          # in-node badge material; never edges
        mcp: { web-intel: [fetch_page, save_evidence] }   # server -> representative tools
        agents: [crawler group, note-reviewer]
        scripts: [scripts/generate.js]
      provenance: dirscan
agents:
  groups:                            # optional; define when >12 agents (chip consolidation)
    - label: "site crawlers"
      ids: [news-crawler, blog-crawler]   # must resolve to real agent ids
      note: "parallel fan-out from collect-sources"
  items:
    - id: news-crawler
      description: "one line"
      model: sonnet                  # frontmatter model, if present
      used_by: [collect-sources]     # skills that launch this agent (binds_agent + body mentions)
      note: null
      provenance: dirscan
hooks:
  items:
    - event: PostToolUse             # from ontology hook_events
      matcher: "Write|Edit"          # matcher, if any
      type: command                  # from ontology hook_types
      command: scripts/check.sh
      provenance: dirscan
  # NOTE: a missing hooks declaration in plugin.json does NOT mean "no hooks" —
  # default-path auto-discovery (hooks/hooks.json) is authoritative; the declaration
  # is usually omitted precisely to avoid duplicate definitions.
commands:
  items:
    - id: some-command               # commands/<id>.md
      description: "one line"
      provenance: dirscan
mcp_servers:
  items:
    - name: web-intel
      tools: 12                      # true tool count (@mcp.tool census); null if unknown
      tool_names: [list_sites, fetch_page]         # known subset only
      transport: stdio               # stdio | streamable-http | sse | free text (e.g. docker)
      note: "scripts/start-mcp.sh"
      external: false                # true for connectors not bundled with the plugin
      provenance: manifest
lsp_servers:
  items: [ { name: ..., note: ..., provenance: dirscan } ]
monitors:
  items: [ { name: ..., note: ..., provenance: dirscan } ]
scripts:
  items:
    - file: skills/report-builder/scripts/generate.js
      note: "spec.json -> report rendering"        # one-line role, seeded from the docstring
      provenance: dirscan
data_references:
  items:
    - file: data/site-catalog.json
      kind: ledger                   # free text; en: ledger/schema/config/template/reference/example
      note: null                     #            ja: 台帳/スキーマ/設定/テンプレート/お作法/例
      provenance: dirscan
```

## flow — execution flow (skills layer)

Designed by Claude/a human (extract emits `flow: null`). Converting with `flow: null`
renders the inventory panels only (useful as a smoke test).

```yaml
flow:
  lanes:
    - { id: main, label: "main flow" }
    - { id: derived, label: "derived -- isolation: ...", style: isolation }  # red dashed frame
  placement:                         # nodes = skills or key data/artifacts
    - { ref: sources.json, lane: main, col: 0, kind: data, desc: "input ledger" }
    - { ref: import-sources, lane: main, col: 1 }      # skill refs pick up role/uses automatically
  edges:                             # type: flow (solid, default) | ref (dashed)
    - { from: sources.json, to: import-sources }
    - { from: a, to: b, type: ref, label: "hash-diff update" }
  zones:                             # phase frames inside the first lane (grey dashed)
    - { cols: [0, 1], label: "input" }
```

Rules:
- Nodes are **skills and key data/artifacts only**. MCP / agent / script dependencies
  stay as `uses` badges, never edges (wiring-reduction rule).
- `col` is the execution order within the lane (ELK partition).
- Skills with role `gate` render as diamonds automatically.

## example_trace — representative invocation

```yaml
example_trace:
  - { actor: user, kind: user, text: "\"find X\" -> triggers match collect-sources" }
  - { actor: collect-sources, kind: orchestrator, text: "reads references/crawl-etiquette.md, ..." }
  - { actor: web-intel, kind: mcp, text: "fetch_page / save_evidence" }
  - { actor: note-audit, kind: gate, text: "lint checks -> pass" }
```
kind: user | skill | orchestrator | agent | mcp | gate | data | script (maps to palette colors).
5-9 steps, grounded in what the SKILL.md files actually say (never invent).

## Draft completion conditions (checked by `validate --yaml`)

- no `# TODO(Claude):` markers remain
- every skill has a `role` from the ontology vocabulary
- every `flow.placement[].ref` resolves to a skill id or carries a `kind`
- every edge endpoint exists in placement
- `agents[].used_by` / `groups[].ids` resolve to real ids
- visibility / provenance / dialect values are within the ontology enums
