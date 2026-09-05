# Draft completion checklist (Layer 2: the quality gate)

extract.py plants `# TODO(Claude):` and `# hint:` comments in the draft.
Follow this checklist to finish it into the canonical YAML. **This step is the quality
gate** — present a summary of what you decided to the user for confirmation before
converting.

## 0. Ground rules

- **Never upgrade provenance beyond the evidence.** Items confirmed only by SKILL.md
  mentions stay `skillmd-mention`.
- **Never invent counts.** Wildcards ("crawler-*", "etc.") mean the true count is unknown —
  say so in a note.
- No emoji inside YAML strings (they turn into tofu in export fonts).
- **A missing declaration in plugin.json does NOT mean absence.** hooks / skills / agents
  are discovered from default paths (hooks/hooks.json, skills/, agents/); manifests
  usually omit the declaration precisely to avoid duplicate definitions. Always settle
  the inventory by dirscan. (Real incident: meiseki's hooks were misreported as
  verified_empty — partly because a stale copy was scanned. **Always check
  `generated.source_root` is the source you intended.**)
- Skills are scanned from the manifest `skills:` path declarations (e.g.
  `./.agents/skills`) with `./skills` as the default — extract.py handles this.
- **Language**: keep every content string in the language declared by `lang:` (en or ja),
  at equal quality. Identifiers and proper nouns stay as-is.

## 1. Assign roles (every skill, required)

Pick from the ontology `skill_roles`. Heuristics:
- manages launch order / output routing / gates of others -> orchestrator
- mandatory pre-delivery audit with reject conditions -> gate (renders as a diamond)
- produces deliverables (decks, cards, reports, rewrites) -> generator; crawls -> collector;
  analyzes -> analyzer
- ingest + schema validation -> importer; incremental refresh -> maintenance;
  stock/scoring -> inventory
- regulation-grounded advice -> advisor; history recording -> recorder;
  aggregation -> reporter; reference knowledge -> knowledge
When unsure, follow the verbs in the SKILL.md body. If no vocabulary fits, ask the
user (adding a role to the ontology is a team decision).

## 2. Settle `uses` (badges)

- Read each SKILL.md body; confirm hinted mentions are real invocations (not examples
  or prohibitions).
- mcp: server -> 2-4 representative tools. agents: fan-out targets (group names allowed).
  scripts: relative paths.
- If there is a degraded mode (fallback when Task is unavailable), mention it in the
  skill's note.

## 3. pipeline_order

Number (1, 2, 3...) only skills in an explicitly serial orchestration ("run in this
order"). Parallel fan-outs get no number.

## 4. agents: used_by / groups

- used_by: settle via binds_agent (frontmatter) first, then body mentions. An agent no
  skill references keeps `used_by: []` with a note ("launcher unconfirmed", or
  "auto-delegated via description").
- With more than 12 agents, define `groups`. Bundle by naming family (e.g. crawler-* /
  reviewer-*) or role, and put the true count in the label. Specialist agents may stay as individual
  chips. Panel titles always show the true item count.

## 5. Design the flow

- lanes: `main` is required. Put quarantined material (contamination-forbidden data,
  derived series) in a `style: isolation` lane. On-demand skills may get their own lane.
- placement: nodes are skills + key data/artifacts only. `col` = execution order
  **within the lane** — every lane starts at col 0 with no gaps.
  The typical shape: input data -> importer -> orchestrator -> store -> gate -> artifact.
- **each lane must read as one linear flow.** When a process alternates between actors
  (planner -> verifier -> planner -> implementer ...), do NOT bounce nodes between
  actor lanes — the arrows tangle. Cut the process into phase lanes (e.g. a planning
  loop lane and an implementation loop lane), joined by a single cross-lane flow edge;
  name the actor in the lane label and each node's `desc`.
- edges: primary flow has no type (solid); references/optional paths are `type: ref`
  (dashed). Loops are a `ref` back-edge to an earlier node in the same lane.
  **MCP / agents / scripts never become edges** (they are badges).
- zones: split the main lane into phases (input / collection / stock / audit / artifacts).

## 6. example_trace

One representative invocation in 5-9 steps. Every step's text must be grounded in what
the SKILL.md actually says (never invent). actor = component name, kind = color
(user/orchestrator/skill/agent/mcp/gate/data/script).

## 7. Finish

- Remove every `# TODO(Claude):` (hint comments may stay).
- Pass `node scripts/validate.js --yaml <file>`.
- Present the role list, grouping and trace summary to the user; convert after
  confirmation.
