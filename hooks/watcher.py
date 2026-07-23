#!/usr/bin/env python3
"""iesens watcher — a PostToolUse hook. Two privacy-preserving jobs:

1) Record a privacy-safe SIGNATURE of each shell command to usage.jsonl: program
   + subcommands + flags only (e.g. 'git push --tags') — never arguments, commit
   messages, paths, secrets, or file contents (the first token is sanitized too).
   This is the *speed-up* signal: a workflow that keeps coming up — whoever runs
   it — may be worth saving as one command. The nudge is gated hard and only fired
   if it's a real time-saver (see coach_pass), and framed as a help offer, never
   "you keep running X".
2) LEARN ADOPTION from behavior: a write to a skill/subagent/command/hook/memory/
   MCP path records that surface to adopted_surfaces.json (suppress-only, safe).

Must be fast and must NEVER fail a tool call — any error exits 0 silently.
Wire via the update-config skill:  PostToolUse -> python hooks/watcher.py
"""
import sys, os, json, time, re

IESENS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "iesens")
USAGE_LOG = os.path.join(IESENS_DIR, "usage.jsonl")
ADOPTED_SURFACES = os.path.join(IESENS_DIR, "adopted_surfaces.json")
MAX_LINES = 2000

VALUE_FLAGS = {"-m", "--message", "-c", "-am", "-F", "-p", "--password", "-u", "--user"}
ATTACHED_VALUE_STEMS = ("-p", "-m", "-u", "-W")
_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_FORBIDDEN = ("/", "\\", "=", "$", '"', "'", "*", "~", "`", "(")


def _safe_prog(tok: str) -> str:
    if _ASSIGN.match(tok) or "$" in tok or "`" in tok or "(" in tok:
        return "(redacted)"
    if any(c in tok for c in ("/", "\\", '"', "'", "*", "~")):
        base = os.path.basename(tok.replace("\\", "/")).strip("\"'")
        if not base or _ASSIGN.match(base) or any(c in base for c in _FORBIDDEN):
            return "(redacted)"
        return base[:24]
    return tok[:24]


def _cmd_sig(command: str) -> str:
    toks = command.strip().split()
    while toks and _ASSIGN.match(toks[0]):
        toks = toks[1:]
    if not toks:
        return "(redacted)"
    out = [_safe_prog(toks[0])]
    for t in toks[1:]:
        if any(ch in t for ch in _FORBIDDEN):
            break
        if t in VALUE_FLAGS:
            out.append(t)
            break
        if len(t) > 2 and t[:2] in ATTACHED_VALUE_STEMS and t[1] != "-":
            out.append(t[:2])
            break
        if t.startswith("-") or (t.replace("-", "").replace(":", "").isalnum() and len(t) <= 16):
            out.append(t)
        else:
            break
        if len(" ".join(out)) >= 40:
            break
    return " ".join(out)[:48]


def _shape(tool: str, tool_input: dict) -> str:
    try:
        if tool in ("Bash", "PowerShell"):
            return _cmd_sig(str(tool_input.get("command", "")))
        return ""
    except Exception:
        return ""


def _adopted_surface(tool: str, tool_input: dict):
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
        os.makedirs(IESENS_DIR, exist_ok=True)
        shape = _shape(tool, ti)
        if shape:  # only shells produce a shape; everything else is logged nowhere
            with open(USAGE_LOG, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"ts": round(time.time(), 1), "tool": tool, "shape": shape}) + "\n")
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
