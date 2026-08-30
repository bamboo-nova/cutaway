# Dialect map: Claude Code format vs Agent Plugins 1.0

Primary source (verified 2026-08-29): https://github.com/agentplugins/agent-plugins-spec
`spec/1.0.0.md`. Agent Plugins 1.0.0 is the packaging standard authored by
OpenAI/Amazon/Cursor/Microsoft/Vercel (published 2026-08-06). Anthropic is not a
participant, but the Claude Code format is a de-facto superset.

| Aspect | claude-code | agent-plugins-1.0 |
|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | root `plugin.json` |
| Required fields | name (by convention) | `$schema` + `name` (closed schema) |
| Allowed fields | unrestricted (mcpServers/hooks/userConfig...) | exactly 10: $schema, name, version, description, author, homepage, repository, license, keywords, extensions |
| skills | `skills/<name>/SKILL.md` (paths declarable) | `skills/<name>/SKILL.md`, **one level deep only** (no deep search) |
| MCP config | `.mcp.json` or manifest `mcpServers` | `mcp.json` (`$schema` + `mcpServers` required) |
| MCP transports | anything (docker run etc. by convention) | stdio / streamable-http / sse only (closed union) |
| Placeholders | `${CLAUDE_PLUGIN_ROOT}`, `${user_config.*}` | `${PLUGIN_ROOT}` (read), `${PLUGIN_DATA}` (writable) only |
| agents / hooks / commands / LSP / monitors | official components | **out of v1 scope** (presence does not affect conformance) |
| Client extensions | — | `extensions` field + reverse-domain directories (`com.example.client/`) |
| Security rules | — | HTTPS required off-localhost / no secrets in env・headers / command is a single token, no escape paths |

## Extraction rules (what extract.py does)

1. **Dialect detection**: `.claude-plugin/plugin.json` present -> claude-code. Otherwise
   read root `plugin.json`; if `$schema` contains `agent-plugins.org/schemas/` ->
   agent-plugins-1.0. Neither -> unknown.
2. **Inventory under agent-plugins-1.0**:
   - Parse `mcp.json` mcpServers (transport / command / url).
   - Scan skills one level deep only (matching the standard's discovery rule).
   - If `agents/`, `hooks/`, `commands/` etc. physically exist, pick them up by dirscan
     and tag the section `spec_status: out-of-spec` (the panel title gains an
     "(out of spec)" suffix). If absent, verified_empty as usual.
   - List the `extensions` field and reverse-domain directories under data_references
     with `kind: extensions`.
   - Closed-schema violations (disallowed fields) are recorded as a warning in
     plugin.note (never rejected).
3. **Rendering implication**: the 9-panel MECE layout is dialect-independent. The
   narrower standard scope is expressed by "(out of spec)" labels — never by removing
   panels.
