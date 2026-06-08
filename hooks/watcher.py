#!/usr/bin/env python3
"""iesens watcher — a PostToolUse hook. Two privacy-preserving jobs:

1) Record an explicit-but-safe SIGNATURE of each shell command to usage.jsonl:
   program + subcommands + flags only (e.g. 'git push --tags', 'npm run build').
   It NEVER stores free-text arguments, commit messages, paths, secrets, or file
   contents — the FIRST token is sanitized too (env-assignments like
   `TOKEN=... cmd` are stripped, command substitutions are redacted, and a path
   program is reduced to its basename), so a secret can't ride in as token 0.
2) LEARN ADOPTION from behavior: when a tool call shows you actually USING a
   native capability (writing a skill/subagent/slash-command, wiring a hook,
   saving a memory file, adding an MCP server), record that surface to
   adopted_surfaces.json so iesens won't teach what you already do.

Must be fast and must NEVER fail a tool call — any error exits 0 silently.
Wire via the update-config skill:  PostToolUse -> python hooks/watcher.py
"""
import sys, os, json, time, re

IESENS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "iesens")
USAGE_LOG = os.path.join(IESENS_DIR, "usage.jsonl")
CONFIG = os.path.join(IESENS_DIR, "config.json")
ADOPTED_SURFACES = os.path.join(IESENS_DIR, "adopted_surfaces.json")
MAX_LINES = 2000  # keep the log bounded; oldest lines fall off

# Flags that take a free-text value (message, password, user) — keep the flag but
# STOP before its value so secrets/messages never enter the log.
VALUE_FLAGS = {"-m", "--message", "-c", "-am", "-F", "-p", "--password", "-u", "--user"}
# Short-flag stems whose ATTACHED value must be dropped (-psecret -> -p, -mWIP -> -m).
ATTACHED_VALUE_STEMS = ("-p", "-m", "-u", "-W")
_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_FORBIDDEN = ("/", "\\", "=", "$", '"', "'", "*", "~", "`", "(")


def _safe_prog(tok: str) -> str:
    """Sanitize the FIRST token (the program). Redact env-assignments and command
    substitutions; reduce a path to its basename; never emit a secret or path."""
    if _ASSIGN.match(tok) or "$" in tok or "`" in tok or "(" in tok:
        return "(redacted)"
    if any(c in tok for c in ("/", "\\", '"', "'", "*", "~")):
        base = os.path.basename(tok.replace("\\", "/")).strip("\"'")
        if not base or _ASSIGN.match(base) or any(c in base for c in _FORBIDDEN):
            return "(redacted)"
        return base[:24]
    return tok[:24]


def _cmd_sig(command: str) -> str:
    """Explicit-but-safe command signature: program + subcommands + flags, e.g.
    'git push --tags' or 'npm run build'. Drops leading env-assignments, stops at
    the first path/value/expansion/quoted token, and never keeps a free-text
    value — so arguments, messages, paths, and secrets are never captured."""
    toks = command.strip().split()
    while toks and _ASSIGN.match(toks[0]):
        toks = toks[1:]  # drop leading VAR=val env assignments (and their values)
    if not toks:
        return "(redacted)"
    out = [_safe_prog(toks[0])]
    for t in toks[1:]:
        if any(ch in t for ch in _FORBIDDEN):
            break  # path / value / expansion / quoted free text
        if t in VALUE_FLAGS:
            out.append(t)
            break  # keep the flag, drop its free-text value
        if len(t) > 2 and t[:2] in ATTACHED_VALUE_STEMS and t[1] != "-":
            out.append(t[:2])  # attached value (-psecret): keep stem, drop value
            break
        if t.startswith("-") or (t.replace("-", "").replace(":", "").isalnum() and len(t) <= 16):
            out.append(t)  # a flag or short subcommand token
        else:
            break
        if len(" ".join(out)) >= 40:
            break
    return " ".join(out)[:48]


def _shape(tool: str, tool_input: dict) -> str:
    """Program+subcommands+flags for shells; file extension for file ops; 'search'
    for find tools — never free-text values, paths, or contents."""
    try:
        if tool in ("Bash", "PowerShell"):
            return _cmd_sig(str(tool_input.get("command", "")))
        if tool in ("Edit", "Write", "Read", "NotebookEdit"):
            path = str(tool_input.get("file_path", ""))
            return os.path.splitext(path)[1].lower() or "(noext)"
        if tool in ("Grep", "Glob"):
            return "search"
        return ""
    except Exception:
        return ""


def _adopted_surface(tool: str, tool_input: dict):
    """If this call shows the user USING a native capability, return its surface
    name. By destination path only (no contents); the loose surfaces (hook,
    memory) are gated on a Claude-specific path segment to avoid false positives
    from unrelated settings.json / *.md edits in other projects."""
    try:
        if tool not in ("Write", "Edit", "NotebookEdit"):
            return None
        p = str(tool_input.get("file_path", "")).replace("\\", "/").lower()
        if not p:
            return None
        if "/.claude/skills/" in p:
            return "skill"
        if "/.claude/agents/" in p:
            return "subagent"
        if "/.claude/commands/" in p:
            return "slash_command"
        if "/.claude/" in p and (p.endswith("settings.json") or p.endswith("settings.local.json")):
            return "hook"
        if p.endswith(".mcp.json"):
            return "mcp"
        if p.endswith("claude.md") or ("/.claude/" in p and "/memory/" in p):
            return "memory"
        return None
    except Exception:
        return None


def _record_adoption(surface: str) -> None:
    """Record an observed-in-use surface to its OWN file (not config.json) so the
    sole writer of config.json stays learn.py — avoiding a lost-update race with
    the async learn hook. Read by the /iesens skill to avoid teaching a capability
    already in use; NOT used to blanket-suppress per-command nudges."""
    try:
        data = {}
        if os.path.exists(ADOPTED_SURFACES):
            with open(ADOPTED_SURFACES, encoding="utf-8") as fh:
                data = json.load(fh)
        surfaces = data.get("surfaces") or []
        if surface not in surfaces:
            surfaces.append(surface)
            data["surfaces"] = surfaces
            tmp = ADOPTED_SURFACES + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2)
            os.replace(tmp, ADOPTED_SURFACES)
    except Exception:
        pass


def main() -> None:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        tool = str(data.get("tool_name", "") or "")
        if not tool:
            return
        ti = data.get("tool_input", {}) or {}
        rec = {"ts": round(time.time(), 1), "tool": tool, "shape": _shape(tool, ti)}
        os.makedirs(IESENS_DIR, exist_ok=True)
        with open(USAGE_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        try:
            with open(USAGE_LOG, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
            if len(lines) > MAX_LINES:
                with open(USAGE_LOG, "w", encoding="utf-8") as fh:
                    fh.writelines(lines[-MAX_LINES:])
        except Exception:
            pass
        surface = _adopted_surface(tool, ti)
        if surface:
            _record_adoption(surface)
    except Exception:
        pass  # never break the tool call
    finally:
        sys.exit(0)


if __name__ == "__main__":
    main()
