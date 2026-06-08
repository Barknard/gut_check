#!/usr/bin/env python3
"""iesens coach pass — a Stop hook (runs when Claude finishes a response).

If the user has REPEATED a real shell command (Bash or PowerShell) enough times,
surface ONE plain-language nudge that names the ACTUAL command and the payoff, and
record it to pending.json so the learn hook can capture yes/no/never next turn.

Signal hygiene — never nudge on:
- Claude's own mechanical activity (file reads/searches/navigation);
- a bare interpreter/file-utility token that collapsed from a per-file command
  (e.g. `python train.py` -> 'python') — nothing reusable to save;
- inline-eval probes (`python -c`, `node -e`) — every run differs;
- a shape that looks tainted (a stray path/secret) — defense in depth.

Relevance gate (PER-KEY): skip if the key was DECLINED, DISMISSED, or ADOPTED, or
it's within cooldown. Only one outstanding nudge at a time (if a fresh pending is
unanswered, stay quiet rather than stack a second). Honors
max_suggestions_per_turn (<=0 disables).

Wire via the update-config skill:  Stop -> python hooks/coach_pass.py
"""
import sys, os, json, time
from collections import Counter

IESENS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "iesens")
USAGE_LOG = os.path.join(IESENS_DIR, "usage.jsonl")
PENDING = os.path.join(IESENS_DIR, "pending.json")
CONFIG = os.path.join(IESENS_DIR, "config.json")
RECENT_WINDOW = 200
LOOKBACK_SECONDS = 6 * 3600
COOLDOWN_SECONDS = 24 * 3600
PENDING_FRESH = 900          # one outstanding nudge at a time (~15 min / next turn)
# Claude's own mechanical shell use (Bash + PowerShell) — never a user workflow.
TRIVIAL_BASH = {"cd", "ls", "pwd", "echo", "cat", "which", "type", "clear", "dir",
                "set", "export", "source", "head", "tail", "grep", "find",
                "get-childitem", "set-location", "get-content", "write-output",
                "write-host", "get-command", "select-object", "where-object",
                "foreach-object", "measure-object", "test-path", "out-null",
                "format-list", "format-table", "get-location"}
# Bare program with NO subcommand/flag = a per-file invocation collapsed to its
# interpreter/utility; the meaningful variation lived in the (dropped) argument.
BARE_PROGRAM_NEEDS_ARG = {"python", "python3", "node", "bash", "sh", "ruby",
                          "perl", "cp", "mv", "rm", "mkdir", "touch", "ln",
                          "chmod", "less", "more", "vim", "nano"}
INLINE_INTERP = {"python", "python3", "node", "ruby", "perl", "bash", "sh", "pwsh", "powershell"}
INLINE_EVAL_FLAGS = {"-c", "-e", "--eval", "--command", "-Command"}
_TAINT = ("=", "$", "/", "\\", '"', "'", "`", "(", "(redacted)")


def _load_config() -> dict:
    try:
        with open(CONFIG, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _plain(shape: str):
    """Name the ACTUAL repeated command explicitly (quoted) + a plain benefit."""
    cmd = (shape or "").strip()
    prog = cmd.split()[0].lower() if cmd else ""
    pattern = f"you keep running `{cmd}` by hand"
    if prog == "git":
        benefit = "it could be one saved command instead of repeating the same steps each time"
    elif prog in ("docker", "kubectl", "terraform", "aws", "gcloud"):
        benefit = "it could be one saved command instead of retyping it"
    else:
        benefit = "it could be a single saved command you run by name"
    return pattern, benefit


def _recent_events() -> list:
    try:
        with open(USAGE_LOG, encoding="utf-8") as fh:
            lines = fh.readlines()[-RECENT_WINDOW:]
    except Exception:
        return []
    now = time.time()
    out = []
    for ln in lines:
        try:
            rec = json.loads(ln)
            if now - float(rec.get("ts", 0)) <= LOOKBACK_SECONDS:
                out.append(rec)
        except Exception:
            continue
    return out


def _tainted(shape: str) -> bool:
    s = shape or ""
    return any(tok in s for tok in _TAINT)


def _automatable(tool: str, shape: str) -> bool:
    """Only a repeated, meaningful USER shell command earns a nudge."""
    if tool not in ("Bash", "PowerShell"):
        return False
    if _tainted(shape):
        return False
    toks = (shape or "").split()
    if not toks:
        return False
    prog = toks[0].lower()
    if prog in TRIVIAL_BASH:
        return False
    if prog in INLINE_INTERP and len(toks) >= 2 and toks[1] in INLINE_EVAL_FLAGS:
        return False  # python -c / node -e throwaway probes
    if len(toks) == 1 and prog in BARE_PROGRAM_NEEDS_ARG:
        return False  # 'python'/'cp' collapsed from a per-file command
    return True


def _fresh_pending() -> bool:
    try:
        if not os.path.exists(PENDING):
            return False
        with open(PENDING, encoding="utf-8") as fh:
            pj = json.load(fh)
        return (time.time() - float(pj.get("ts", 0))) < PENDING_FRESH
    except Exception:
        return False


def main() -> None:
    try:
        cfg = _load_config()
        if not cfg.get("enabled", True) or cfg.get("quiet", False):
            return
        if int(cfg.get("max_suggestions_per_turn", 1)) <= 0:
            return
        if _fresh_pending():
            return  # one outstanding nudge at a time — wait for the reply
        detectors = cfg.get("detectors", {}) or {}
        rep = detectors.get("repetition_to_skill_or_agent",
                            detectors.get("skill", {})) or {}
        if rep.get("enabled", True) is False:
            return
        min_repeats = int(rep.get("min_repeats", 3))

        dismissed = set(cfg.get("dismissed") or [])
        declined = set(cfg.get("declined") or [])
        adopted = set(cfg.get("adopted") or [])
        cooldown = cfg.get("cooldown") or {}

        events = _recent_events()
        if not events:
            return
        counts = Counter((e.get("tool", ""), e.get("shape", "")) for e in events
                         if _automatable(e.get("tool", ""), e.get("shape", "")))
        now = time.time()
        for (tool, shape), n in counts.most_common(5):
            if n < min_repeats:
                break
            key = f"repetition::{tool}::{shape}"
            surface = "skill"
            if key in dismissed or key in declined or key in adopted:
                continue
            cd = cooldown.get(key)
            if cd and (now - float(cd)) < COOLDOWN_SECONDS:
                continue
            opp = {
                "detector": "repetition_to_skill_or_agent",
                "key": key,
                "surface": surface,
                "signature": {"tool": tool, "shape": shape, "count": n},
                "ts": round(time.time(), 1),
            }
            os.makedirs(IESENS_DIR, exist_ok=True)
            with open(PENDING, "w", encoding="utf-8") as fh:
                json.dump(opp, fh)
            pattern, benefit = _plain(shape)
            msg = (f"[iesens] noticed {pattern} — {benefit}. "
                   f"Would you like to know more? (yes / no / or just keep working)")
            try:
                print(json.dumps({"systemMessage": msg}))
            except Exception:
                pass
            break
    except Exception:
        pass
    finally:
        sys.exit(0)


if __name__ == "__main__":
    main()
