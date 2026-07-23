#!/usr/bin/env python3
"""iesens coach pass — a Stop hook. Surfaces ONE help-offer nudge, gated to real
time-savers, from two signals — the user's input comes first:

1) PRIMARY — repeated USER REQUESTS (from learn.py's user_intents.jsonl):
   "you keep asking me to `run tests` — a saved command could do it in one step".
2) SECONDARY — a repeated real shell command in the work (from watcher.py's
   usage.jsonl), at a HIGHER bar, framed as a help offer about the workflow:
   "`npm run build` keeps coming up — want it as one command?". This is NEVER
   phrased as "you keep running X" (the user may not have run it — Claude did);
   it's only surfaced when it's plausibly a real speed-up.

Noise never nudges: Claude's reads/searches/navigation, bare collapsed programs
(`python` from `python train.py`), inline-eval probes (`python -c`), and tainted
shapes are all filtered. Per-key relevance gate (adopted/declined/dismissed/
cooldown); one outstanding nudge at a time; honors max_suggestions_per_turn.

Wire via the update-config skill:  Stop -> python hooks/coach_pass.py
"""
import sys, os, json, time
from collections import Counter

IESENS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "iesens")
USAGE_LOG = os.path.join(IESENS_DIR, "usage.jsonl")
INTENTS = os.path.join(IESENS_DIR, "user_intents.jsonl")
PENDING = os.path.join(IESENS_DIR, "pending.json")
CONFIG = os.path.join(IESENS_DIR, "config.json")
RECENT_WINDOW = 200
LOOKBACK_SECONDS = 6 * 3600
COOLDOWN_SECONDS = 24 * 3600
PENDING_FRESH = 900
TRIVIAL_BASH = {"cd", "ls", "pwd", "echo", "cat", "which", "type", "clear", "dir",
                "set", "export", "source", "head", "tail", "grep", "find",
                "get-childitem", "set-location", "get-content", "write-output",
                "write-host", "get-command", "select-object", "where-object",
                "foreach-object", "measure-object", "test-path", "out-null",
                "format-list", "format-table", "get-location"}
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


def _recent(path: str):
    try:
        with open(path, encoding="utf-8") as fh:
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
        return False
    if len(toks) == 1 and prog in BARE_PROGRAM_NEEDS_ARG:
        return False
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


def _emit(cfg, key, surface, shape, pattern, benefit):
    opp = {"key": key, "surface": surface,
           "signature": {"shape": shape}, "ts": round(time.time(), 1)}
    os.makedirs(IESENS_DIR, exist_ok=True)
    with open(PENDING, "w", encoding="utf-8") as fh:
        json.dump(opp, fh)
    msg = (f"[iesens] noticed {pattern} — {benefit}. "
           f"Would you like to know more? (yes / no / or just keep working)")
    try:
        print(json.dumps({"systemMessage": msg}))
    except Exception:
        pass


def main() -> None:
    try:
        cfg = _load_config()
        if not cfg.get("enabled", True) or cfg.get("quiet", False):
            return
        if int(cfg.get("max_suggestions_per_turn", 1)) <= 0:
            return
        if _fresh_pending():
            return
        rep = (cfg.get("detectors", {}) or {}).get(
            "repetition_to_skill_or_agent", (cfg.get("detectors", {}) or {}).get("skill", {})) or {}
        if rep.get("enabled", True) is False:
            return
        intent_min = int(rep.get("min_repeats", 3))
        command_min = max(intent_min + 1, 4)  # higher bar for work-derived nudges

        dismissed = set(cfg.get("dismissed") or [])
        declined = set(cfg.get("declined") or [])
        adopted = set(cfg.get("adopted") or [])
        cooldown = cfg.get("cooldown") or {}
        now = time.time()

        def gated(key):
            if key in dismissed or key in declined or key in adopted:
                return True
            cd = cooldown.get(key)
            return bool(cd and (now - float(cd)) < COOLDOWN_SECONDS)

        # --- candidates, USER INTENT first (primary), then command time-savers ---
        candidates = []  # (key, surface, shape, pattern, benefit)
        for sig, n in Counter(r.get("sig", "") for r in _recent(INTENTS)).most_common(6):
            if sig and n >= intent_min:
                candidates.append((f"user_intent::{sig}", "slash_command", sig,
                                   f"you keep asking me to `{sig}`",
                                   "a saved command could do it in one step"))
        cmds = Counter((r.get("tool", ""), r.get("shape", "")) for r in _recent(USAGE_LOG)
                       if _automatable(r.get("tool", ""), r.get("shape", "")))
        for (tool, shape), n in cmds.most_common(6):
            if n >= command_min:
                candidates.append((f"repetition::{tool}::{shape}", "slash_command", shape,
                                   f"`{shape}` keeps coming up in this project",
                                   "a saved command could make it one step"))

        for key, surface, shape, pattern, benefit in candidates:
            if gated(key):
                continue
            _emit(cfg, key, surface, shape, pattern, benefit)
            break
    except Exception:
        pass
    finally:
        sys.exit(0)


if __name__ == "__main__":
    main()
