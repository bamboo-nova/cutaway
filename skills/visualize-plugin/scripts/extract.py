#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""cutaway Layer 1: inventory a plugin's sources -> structure YAML draft.

Auto-detects the packaging dialect (claude-code / agent-plugins-1.0 / unknown) and
emits a plugin-structure/v1.1 draft with provenance / visibility on every item.
role, flow and example_trace are left as TODOs -- completing them is the human/Claude
quality gate (Layer 2).

Usage:
    uv run extract.py <plugin-root> -o <out.yaml> [--env claude-code|claude-ai]
                      [--dialect auto|claude-code|agent-plugins-1.0] [--lang en|ja]
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

try:
    import yaml as _yaml
except ImportError:  # degraded mode when run with bare python3 instead of uv
    _yaml = None

SECTIONS = [
    "skills", "agents", "hooks", "commands", "mcp_servers",
    "lsp_servers", "monitors", "scripts", "data_references",
]
AGENT_PLUGINS_ALLOWED_FIELDS = {
    "$schema", "name", "version", "description", "author",
    "homepage", "repository", "license", "keywords", "extensions",
}
MCP_TOOL_RE = re.compile(r"^\s*@\w+\.tool\b", re.MULTILINE)
MCP_CALL_RE = re.compile(r"mcp__(?:plugin_[\w-]+?_)?([A-Za-z0-9_-]+?)__([A-Za-z0-9_*]+)")
REVERSE_DOMAIN_DIR_RE = re.compile(r"^(com|org|net|io|dev|app|ai)\.[a-z0-9.-]+$")
SKIP_DIRS = {
    ".git", ".venv", "node_modules", "__pycache__", ".ruff_cache",
    ".pytest_cache", ".claude", ".claude-plugin", "out", "downloads",
}

# Localized strings that end up INSIDE the structure YAML (content language).
# TODO/hint comments stay English in both locales -- they are instructions for Claude.
L10N = {
    "en": {
        "title": "{name} plugin structure map",
        "kinds": {"schema": "schema", "template": "template", "config": "config",
                  "ledger": "ledger", "example": "example", "etiquette": "reference"},
        "codex_manifest": "Codex CLI compatibility manifest",
        "external_mcp": "external connector (not bundled; lower bound from SKILL.md mentions)",
    },
    "ja": {
        "title": "{name} プラグイン構成図",
        "kinds": {"schema": "スキーマ", "template": "テンプレート", "config": "設定",
                  "ledger": "台帳", "example": "例", "etiquette": "お作法"},
        "codex_manifest": "Codex CLI 対応マニフェスト",
        "external_mcp": "外部コネクタ（プラグイン非同梱。SKILL.md言及からの下限値）",
    },
}


def q(s: object) -> str:
    """Render a scalar safely for YAML output (escaping via json.dumps).

    Args:
        s: Value to render.

    Returns:
        A string safe to embed as a YAML scalar.
    """
    if s is None:
        return "null"
    if isinstance(s, bool):
        return "true" if s else "false"
    if isinstance(s, (int, float)):
        return str(s)
    text = str(s)
    if re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_./-]*", text) and text not in ("null", "true", "false"):
        return text
    return json.dumps(text, ensure_ascii=False)


def parse_frontmatter(md_path: Path) -> tuple[dict, str]:
    """Return (frontmatter dict, body) of a SKILL.md / agent md file.

    Args:
        md_path: Markdown file to parse.

    Returns:
        Tuple of frontmatter mapping and body text; ({}, full text) when no frontmatter.
    """
    try:
        text = md_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}, ""
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return {}, text
    body = text[m.end():]
    raw = m.group(1)
    if _yaml is not None:
        try:
            fm = _yaml.safe_load(raw) or {}
            return (fm if isinstance(fm, dict) else {}), body
        except Exception:
            pass
    # Degraded: naive key: value parsing (multiline blocks -> first line only).
    fm: dict = {}
    for line in raw.splitlines():
        mm = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if mm:
            fm[mm.group(1)] = mm.group(2).strip()
    return fm, body


def first_line(s: object) -> str | None:
    """Return the first non-empty line of a multi-line string."""
    if not isinstance(s, str):
        return None
    for line in s.splitlines():
        line = line.strip()
        if line:
            return line
    return None


def load_json(p: Path) -> dict | None:
    """Load a JSON file, returning None on failure."""
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def detect_dialect(root: Path, forced: str) -> tuple[str, dict, Path | None, list[str]]:
    """Detect the packaging dialect from the manifest.

    Args:
        root: Plugin root directory.
        forced: --dialect value; anything but "auto" forces the dialect.

    Returns:
        (dialect, manifest dict, manifest path, warnings).
    """
    warnings: list[str] = []
    cc = root / ".claude-plugin" / "plugin.json"
    ap = root / "plugin.json"
    if forced != "auto":
        if forced == "claude-code":
            return "claude-code", load_json(cc) or {}, cc if cc.exists() else None, warnings
        mf = load_json(ap) or {}
        return "agent-plugins-1.0", mf, ap if ap.exists() else None, warnings
    if cc.exists():
        return "claude-code", load_json(cc) or {}, cc, warnings
    if ap.exists():
        mf = load_json(ap) or {}
        schema = str(mf.get("$schema", ""))
        if "agent-plugins.org/schemas/" in schema:
            extra = sorted(set(mf) - AGENT_PLUGINS_ALLOWED_FIELDS)
            if extra:
                warnings.append(f"closed-schema violation, fields ignored: {', '.join(extra)}")
            return "agent-plugins-1.0", mf, ap, warnings
        warnings.append("root plugin.json exists but its $schema is not the Agent Plugins standard")
        return "unknown", mf, ap, warnings
    return "unknown", {}, None, warnings


def note_of_script(p: Path) -> str | None:
    """Pick up the first docstring/comment line of a script as its one-line note."""
    try:
        head = p.read_text(encoding="utf-8", errors="replace")[:2000]
    except OSError:
        return None
    m = re.search(r'"""(.*?)(?:\n|""")', head, re.DOTALL) or re.search(r"^(?:#|//)\s*(.+)$", head, re.MULTILINE)
    if m:
        line = m.group(1).strip().strip('"')
        return line[:80] if line else None
    return None


def count_mcp_tools(root: Path, command: str) -> tuple[int | None, list[str]]:
    """Count @*.tool decorators (and collect tool names) in the MCP server implementation.

    Args:
        root: Plugin root.
        command: Server launch command (used as a search hint for .py entrypoints).

    Returns:
        (tool count or None, list of discovered tool names).
    """
    candidates = [root / "main.py"]
    for token in re.findall(r"[\w./-]+\.py", command or ""):
        candidates.append(root / token.lstrip("./"))
    for p in candidates:
        if p.exists():
            text = p.read_text(encoding="utf-8", errors="replace")
            count = len(MCP_TOOL_RE.findall(text))
            if count:
                names = re.findall(r"^\s*@\w+\.tool\b.*?\n\s*(?:async\s+)?def\s+(\w+)", text, re.MULTILINE)
                return count, names
    return None, []


def extract(root: Path, env: str, forced_dialect: str, lang: str) -> str:
    """Inventory a plugin and return the structure YAML draft as a string."""
    root = root.resolve()
    t = L10N[lang]
    dialect, manifest, manifest_path, warnings = detect_dialect(root, forced_dialect)
    prov_manifest = manifest_path is not None
    plugin_name = manifest.get("name") or root.name
    name_prov = "manifest" if manifest.get("name") else "inferred"
    not_visible = env == "claude-ai"

    # ---- skills (honor manifest `skills` path declarations; default ./skills) ----
    skills: list[dict] = []
    skill_dirs: dict[str, Path] = {}
    skill_bodies: dict[str, str] = {}
    declared = manifest.get("skills") if isinstance(manifest.get("skills"), list) else None
    for rel in declared or ["./skills"]:
        skills_dir = (root / str(rel)).resolve()  # Path normalizes ./ (lstrip would break .agents etc.)
        if not skills_dir.is_dir():
            continue
        for d in sorted(skills_dir.iterdir()):
            smd = d / "SKILL.md"
            if d.is_dir() and smd.is_file() and d.name not in skill_dirs:
                fm, body = parse_frontmatter(smd)
                skill_bodies[d.name] = body
                skill_dirs[d.name] = d
                skills.append({
                    "id": d.name,
                    "description": first_line(fm.get("description")) or "",
                    "argument_hint": fm.get("argument-hint") or fm.get("argument_hint"),
                    "context": fm.get("context"),
                    "binds_agent": fm.get("agent"),
                    "allowed_tools": fm.get("allowedTools") or fm.get("allowed-tools"),
                })

    # ---- agents ----
    agents: list[dict] = []
    agents_dir = root / "agents"
    if agents_dir.is_dir():
        for f in sorted(agents_dir.glob("*.md")):
            fm, _body = parse_frontmatter(f)
            agents.append({
                "id": fm.get("name") or f.stem,
                "description": first_line(fm.get("description")) or "",
                "model": fm.get("model"),
            })

    # ---- hooks ----
    # NOTE: manifest hook declarations are usually OMITTED to avoid duplicating the
    # default-path auto-discovery (hooks/hooks.json). Never infer absence from the
    # manifest -- always scan the default path.
    hooks: list[dict] = []
    hooks_json = load_json(root / "hooks" / "hooks.json")
    hook_sources = [hooks_json.get("hooks") if hooks_json else None, manifest.get("hooks")]
    for src in hook_sources:
        if isinstance(src, dict):
            for event, entries in src.items():
                if not isinstance(entries, list):
                    continue
                for entry in entries:
                    for h in (entry.get("hooks", []) if isinstance(entry, dict) else []):
                        hooks.append({
                            "event": event,
                            "matcher": entry.get("matcher") if isinstance(entry, dict) else None,
                            "type": h.get("type"),
                            "command": h.get("command") or h.get("url") or h.get("prompt"),
                        })

    # ---- commands ----
    commands: list[dict] = []
    commands_dir = root / "commands"
    if commands_dir.is_dir():
        for f in sorted(commands_dir.glob("*.md")):
            fm, _ = parse_frontmatter(f)
            commands.append({"id": f.stem, "description": first_line(fm.get("description")) or ""})

    # ---- bundled MCP servers ----
    mcp_servers: list[dict] = []
    mcp_cfg_file = root / ("mcp.json" if dialect == "agent-plugins-1.0" else ".mcp.json")
    mcp_defs: dict[str, dict] = {}
    for src, prov in [(load_json(mcp_cfg_file), "dirscan"), (manifest, "manifest")]:
        servers = (src or {}).get("mcpServers")
        if isinstance(servers, dict):
            for name, cfg in servers.items():
                if name not in mcp_defs and isinstance(cfg, dict):
                    mcp_defs[name] = {**cfg, "_prov": prov}
    for name, cfg in mcp_defs.items():
        command = str(cfg.get("command", ""))
        tools, tool_names = count_mcp_tools(root, command)
        mcp_servers.append({
            "name": name,
            "tools": tools,
            "tool_names": tool_names,
            "transport": cfg.get("type") or ("stdio" if command else None),
            "note": command or cfg.get("url"),
            "external": False,
            "provenance": cfg["_prov"],
        })
    bundled = set(mcp_defs)

    # ---- body scan: uses (MCP/agents/scripts), inter-skill mentions, external connectors ----
    agent_ids = [a["id"] for a in agents]
    skill_ids = [s["id"] for s in skills]
    external_servers: dict[str, set[str]] = {}
    hints: dict[str, list[str]] = {}
    bundled_tools = {m["name"]: m["tool_names"] for m in mcp_servers}
    for s in skills:
        body = skill_bodies.get(s["id"], "") + "\n" + s["description"]
        mcp_uses: dict[str, list[str]] = {}

        def add_use(server: str, tool: str | None, mcp_uses: dict = mcp_uses) -> None:
            mcp_uses.setdefault(server, [])
            if server not in bundled and server != "":
                external_servers.setdefault(server, set())
                if tool:
                    external_servers[server].add(tool)
            if tool and tool not in mcp_uses[server] and len(mcp_uses[server]) < 4:
                mcp_uses[server].append(tool)

        # Prefer the structured allowedTools form (- mcp: <server> / tools: [...]).
        at = s.get("allowed_tools")
        if isinstance(at, list):
            for entry in at:
                if isinstance(entry, dict) and "mcp" in entry:
                    server = str(entry["mcp"])
                    tools = entry.get("tools") or []
                    if tools:
                        for tname in tools:
                            add_use(server, str(tname))
                    else:
                        add_use(server, None)
                elif isinstance(entry, str):
                    body += "\n" + entry
        elif isinstance(at, str):
            body += "\n" + at
        for server, tool in MCP_CALL_RE.findall(body):
            add_use(server, None if tool == "*" else tool)
        for server in bundled:
            if server in body and server not in mcp_uses:
                mcp_uses[server] = []
        # For bundled servers with no representative tools yet, fill from body mentions.
        for server, tools in mcp_uses.items():
            if not tools:
                for tname in bundled_tools.get(server, []):
                    if len(tools) >= 4:
                        break
                    if re.search(rf"\b{re.escape(tname)}\b", body):
                        tools.append(tname)
        s["uses_mcp"] = mcp_uses
        s["uses_agents"] = [x for x in agent_ids if x != s["id"] and re.search(rf"\b{re.escape(x)}\b", body)]
        s["uses_scripts"] = sorted({m.group(0).strip("`'\"()") for m in
                                    re.finditer(r"[\w./-]*scripts/[\w.-]+\.(?:py|js|sh)", body)})
        mentioned = [o for o in skill_ids if o != s["id"] and re.search(rf"\b{re.escape(o)}\b", body)]
        if mentioned:
            hints[s["id"]] = mentioned
    for name, tools in external_servers.items():
        mcp_servers.append({
            "name": name, "tools": None, "tool_names": sorted(tools)[:6], "transport": None,
            "note": t["external_mcp"],
            "external": True, "provenance": "skillmd-mention",
        })

    # ---- lsp / monitors ----
    lsp: list[dict] = []
    lsp_json = load_json(root / ".lsp.json") or (load_json(root / "lsp.json") if dialect != "claude-code" else None)
    if isinstance(lsp_json, dict):
        for name in lsp_json.get("lspServers", lsp_json):
            lsp.append({"name": name})
    monitors: list[dict] = []
    for name in (manifest.get("monitors") or {}):
        monitors.append({"name": name})

    # ---- scripts (plugin-level + per-skill) ----
    scripts: list[dict] = []
    for base in [root / "scripts"] + [skill_dirs[s["id"]] / "scripts" for s in skills]:
        if base.is_dir():
            for f in sorted(base.iterdir()):
                if f.is_file() and f.suffix in (".py", ".js", ".sh", ".ts"):
                    scripts.append({"file": str(f.relative_to(root)), "note": note_of_script(f)})

    # ---- data / references ----
    data_refs: list[dict] = []
    kinds = t["kinds"]

    def kind_of(p: Path) -> str:
        n = p.name.lower()
        if "schema" in n:
            return kinds["schema"]
        if "template" in n:
            return kinds["template"]
        if p.suffix in (".json", ".yaml", ".yml") and ("rc" in n or "config" in n or "settings" in n):
            return kinds["config"]
        if p.suffix in (".json", ".yaml", ".yml"):
            return kinds["ledger"]
        if "example" in str(p).lower():
            return kinds["example"]
        return kinds["etiquette"]

    for base in [root / "data", root / "templates", root / "config"]:
        if base.is_dir():
            for f in sorted(base.iterdir()):
                if f.is_file() and not f.name.startswith("."):
                    data_refs.append({"file": str(f.relative_to(root)), "kind": kind_of(f)})
    for s in skills:
        for sub in ("references", "assets"):
            base = skill_dirs[s["id"]] / sub
            if base.is_dir():
                for f in sorted(base.iterdir()):
                    if f.is_file():
                        data_refs.append({"file": str(f.relative_to(root)), "kind": kind_of(f)})
    for f in sorted(root.glob(".*rc*")):
        if f.is_file() and f.suffix in (".json", ".yaml", ".yml"):
            data_refs.append({"file": f.name, "kind": kinds["config"]})
    if (root / ".codex-plugin" / "plugin.json").is_file():
        data_refs.append({"file": ".codex-plugin/plugin.json", "kind": kinds["config"],
                          "note": t["codex_manifest"]})
    if dialect == "agent-plugins-1.0":
        if isinstance(manifest.get("extensions"), dict):
            for ns in manifest["extensions"]:
                data_refs.append({"file": f"plugin.json#extensions.{ns}", "kind": "extensions"})
        for d in sorted(root.iterdir()):
            if d.is_dir() and REVERSE_DOMAIN_DIR_RE.match(d.name):
                data_refs.append({"file": d.name + "/", "kind": "extensions"})

    # ---- YAML emission (hand-rolled so we can plant TODO/hint comments) ----
    out_of_spec = dialect == "agent-plugins-1.0"
    L: list[str] = []
    a = L.append
    a("schema: plugin-structure/v1.1")
    a("ontology: claude-plugin/v1")
    a(f"dialect: {q(dialect)}")
    a(f"lang: {lang}")
    a(f"title: {q(t['title'].format(name=plugin_name))}")
    a("generated:")
    a("  by: extract.py/1.1")
    a(f"  at: {q(datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'))}")
    a(f"  environment: {q('claude-ai-skillmd' if not_visible else 'claude-code-dirscan')}")
    a(f"  source_root: {q(str(root))}")
    a("plugin:")
    a(f"  name: {q(plugin_name)}  # provenance: {name_prov}")
    a(f"  version: {q(manifest.get('version'))}")
    a(f"  overview: {q(first_line(manifest.get('description')) or '')}  # TODO(Claude): refine into one sentence")
    note = "; ".join(warnings) if warnings else None
    a(f"note: {q(note)}  # TODO(Claude): header caveat for the diagram (leave null if none)")
    a("components:")

    def section(name: str, items: list[dict], prov: str, render, extra_note: str | None = None,
                oos: bool = False) -> None:
        a(f"  {name}:")
        vis = "not_visible" if (not_visible and name != "skills") else ("verified" if items else "verified_empty")
        a(f"    visibility: {vis}")
        a(f"    provenance: {prov}")
        if oos and items:
            a("    spec_status: out-of-spec  # exists but outside Agent Plugins 1.0 standard scope")
        if extra_note:
            a(f"    note: {q(extra_note)}")
        if not items:
            a("    items: []")
            return
        a("    items:")
        for it in items:
            render(it)

    def r_skill(s: dict) -> None:
        a(f"      - id: {q(s['id'])}")
        a("        role: null  # TODO(Claude): pick from ontology skill_roles")
        a(f"        description: {q(s['description'])}")
        a("        pipeline_order: null  # TODO(Claude): order within serial orchestration (null if n/a)")
        for k in ("binds_agent", "context", "argument_hint"):
            if s.get(k):
                a(f"        {k}: {q(s[k])}")
        a("        uses:")
        if s["uses_mcp"]:
            a("          mcp:")
            for server, tools in s["uses_mcp"].items():
                a(f"            {q(server)}: [{', '.join(q(x) for x in tools)}]")
        else:
            a("          mcp: {}")
        a(f"          agents: [{', '.join(q(x) for x in s['uses_agents'][:12])}]"
          + ("  # hint: body mentions -- verify these are real invocations" if s["uses_agents"] else ""))
        a(f"          scripts: [{', '.join(q(x) for x in s['uses_scripts'])}]")
        if s["id"] in hints:
            a(f"        # hint: body mentions skills {', '.join(hints[s['id']])} (orchestrates candidates)")
        a("        provenance: dirscan")

    def r_agent(ag: dict) -> None:
        used_by = [s["id"] for s in skills if ag["id"] in s["uses_agents"] or s.get("binds_agent") == ag["id"]]
        a(f"      - id: {q(ag['id'])}")
        a(f"        description: {q(ag['description'])}")
        if ag.get("model"):
            a(f"        model: {q(ag['model'])}")
        a(f"        used_by: [{', '.join(q(u) for u in used_by)}]"
          + ("" if used_by else "  # TODO(Claude): confirm the launcher by reading SKILL.md bodies"))
        a("        provenance: dirscan")

    section("skills", skills, "dirscan", r_skill)
    if len(agents) > 12:
        a("  # TODO(Claude): >12 agents -- define groups to consolidate chips (extraction-checklist.md section 4)")
    section("agents", agents, "dirscan", r_agent, oos=out_of_spec)

    def r_hook(h: dict) -> None:
        a(f"      - event: {q(h['event'])}")
        if h.get("matcher"):
            a(f"        matcher: {q(h['matcher'])}")
        a(f"        type: {q(h['type'])}")
        a(f"        command: {q(h['command'])}")
        a(f"        provenance: {'dirscan' if hooks_json else 'manifest'}")

    section("hooks", hooks, "dirscan" if hooks_json or not manifest.get("hooks") else "manifest",
            r_hook, oos=out_of_spec)
    section("commands", commands, "dirscan",
            lambda c: (a(f"      - id: {q(c['id'])}"), a(f"        description: {q(c['description'])}"),
                       a("        provenance: dirscan")),
            oos=out_of_spec)

    def r_mcp(m: dict) -> None:
        a(f"      - name: {q(m['name'])}")
        a(f"        tools: {q(m['tools'])}")
        a(f"        tool_names: [{', '.join(q(x) for x in m['tool_names'])}]")
        a(f"        transport: {q(m['transport'])}")
        a(f"        note: {q(m['note'])}")
        a(f"        external: {q(m['external'])}")
        a(f"        provenance: {q(m['provenance'])}")

    section("mcp_servers", mcp_servers, "manifest" if prov_manifest else "dirscan", r_mcp)
    section("lsp_servers", lsp, "dirscan",
            lambda x: (a(f"      - name: {q(x['name'])}"), a("        provenance: dirscan")),
            oos=out_of_spec)
    section("monitors", monitors, "manifest",
            lambda x: (a(f"      - name: {q(x['name'])}"), a("        provenance: manifest")),
            oos=out_of_spec)
    section("scripts", scripts, "dirscan",
            lambda sc: (a(f"      - file: {q(sc['file'])}"), a(f"        note: {q(sc['note'])}"),
                        a("        provenance: dirscan")))

    def r_data(dref: dict) -> None:
        a(f"      - file: {q(dref['file'])}")
        a(f"        kind: {q(dref['kind'])}")
        if dref.get("note"):
            a(f"        note: {q(dref['note'])}")
        a("        provenance: dirscan")

    section("data_references", data_refs, "dirscan", r_data)
    a("flow: null  # TODO(Claude): design lanes/placement/edges/zones (extraction-checklist.md section 5)")
    a("example_trace: null  # TODO(Claude): representative 5-9 step trace (extraction-checklist.md section 6)")
    a("")
    return "\n".join(L)


def main() -> None:
    """CLI entrypoint."""
    ap = argparse.ArgumentParser(description="plugin source -> structure YAML draft")
    ap.add_argument("root", type=Path)
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--env", choices=["claude-code", "claude-ai"], default="claude-code")
    ap.add_argument("--dialect", choices=["auto", "claude-code", "agent-plugins-1.0"], default="auto")
    ap.add_argument("--lang", choices=["en", "ja"], default="en",
                    help="content language for the draft (chrome strings at render time follow this too)")
    args = ap.parse_args()
    if not args.root.is_dir():
        sys.exit(f"error: {args.root} is not a directory")
    text = extract(args.root, args.env, args.dialect, args.lang)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    todos = text.count("TODO(Claude)")
    print(f"{args.out}  ({len(text.splitlines())} lines, {todos} TODOs)")


if __name__ == "__main__":
    main()
