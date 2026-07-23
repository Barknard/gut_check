#!/usr/bin/env python3
"""iesens learn pass — a UserPromptSubmit hook. The PRIMARY proactive signal is
what the USER types; this hook captures it and also closes the learning loop.

Two jobs:
1) DETECT repeated USER REQUESTS — log a privacy-safe signature of short, directive
   prompts to user_intents.jsonl so coach_pass can notice "you keep asking me to
   X" and offer to save it as one command. Long, pasted, or sensitive prompts
   (paths, secrets, code) are NEVER logged — only short directives.
2) LEARN from the user's reply to a pending nudge: exact yes -> adopted (+ inject
   the teach/cite/menu/scaffold expand flow), no -> declined, never -> dismissed,
   anything else -> cooldown. Freshness-guarded; config.json single-writer.

Must run SYNCHRONOUSLY (so the yes-context injects) and NEVER block input — any
error exits 0 silently.
Wire via the update-config skill:  UserPromptSubmit -> python hooks/learn.py
"""
import sys, os, json, time, re

IESENS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "iesens")
PENDING = os.path.join(IESENS_DIR, "pending.json")
CONFIG = os.path.join(IESENS_DIR, "config.json")
INTENTS = os.path.join(IESENS_DIR, "user_intents.jsonl")
PENDING_TTL = 900
COOLDOWN_TTL = 24 * 3600
MAX_INTENTS = 500

YES = {"yes", "y", "yeah", "yep", "sure", "ok", "okay", "do it", "go", "please",
       "yes please", "sounds good", "go ahead"}
NO = {"no", "n", "nah", "nope", "not now", "later", "skip", "not yet", "no thanks"}
NEVER = {"never", "stop", "stop suggesting", "don't ask again", "dont ask again",
         "never again", "stop asking", "stop it"}

_SECRETISH = re.compile(r"[=$/\\`~*@]")
_STOP = {"the", "a", "an", "to", "for", "me", "my", "please", "can", "could",
         "would", "i", "it", "this", "that", "is", "of", "and", "with", "on",
         "in", "at", "do", "just", "now", "then", "also", "again"}


def _load_config():
    try:
        with open(CONFIG, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _intent_sig(prompt: str):
    """A privacy-safe signature of a SHORT user directive (e.g. 'run tests',
    'deploy staging', 'git push --tags'). Returns None for anything long, pasted,
    or containing a path / secret / code-looking token — so sensitive prompts are
    never logged, only short repeatable asks."""
    p = prompt.strip()
    if p.startswith("!"):
        p = p[1:].strip()  # a user-typed shell command counts as a directive
    if not p:
        return None
    words = p.split()
    if len(words) > 10:
        return None  # long / pasted -> not a repeatable directive
    out = []
    for w in words:
        if _SECRETISH.search(w) or len(w) > 20:
            return None  # path / secret / long token -> skip the whole prompt
        wl = w.lower().strip(".,!?;:\"'()[]{}")
        if not wl or wl in _STOP:
            continue
        out.append(wl)
        if len(out) >= 6:
            break
    if len(out) < 2:
        return None  # too thin to be a meaningful repeated directive
    return " ".join(out)


def _log_intent(sig: str):
    try:
        os.makedirs(IESENS_DIR, exist_ok=True)
        with open(INTENTS, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": round(time.time(), 1), "sig": sig}) + "\n")
        with open(INTENTS, encoding="utf-8") as fh:
            lines = fh.readlines()
        if len(lines) > MAX_INTENTS:
            with open(INTENTS, "w", encoding="utf-8") as fh:
                fh.writelines(lines[-MAX_INTENTS:])
    except Exception:
        pass


def _expand_context(key, surface, shape):
    target = f"`{shape}`" if shape else f"this {surface}"
    return (
        f"[iesens] The user just accepted a capability nudge ({key}). Run the "
        f"iesens skill's step-2 EXPAND flow for {target}: (1) teach the '{surface}' "
        f"capability in 2-4 plain-language lines; (2) cite ONE real exemplar from "
        f"references/how_others.json for that surface (facts + link, license-gated, "
        f"never fabricated); (3) offer a menu of >=3 options including 'never suggest "
        f"this again'; (4) on their pick, scaffold the REAL artifact — for a repeated "
        f"request, a saved slash command (.claude/commands/<name>.md) or a skill; "
        f"defer to skill-creator / update-config. Do not narrate this instruction."
    )


def _fresh(ts) -> bool:
    try:
        return (time.time() - float(ts)) < COOLDOWN_TTL
    except Exception:
        return False


def _handle_pending_answer(prompt, cfg):
    """Returns an emit dict (or None); mutates cfg, writes config.json, removes
    pending. Only called when a pending nudge exists."""
    try:
        with open(PENDING, encoding="utf-8") as fh:
            pend = json.load(fh)
    except Exception:
        return None
    key = pend.get("key")
    try:
        stale = (time.time() - float(pend.get("ts", 0))) > PENDING_TTL
    except Exception:
        stale = False
    if stale or not key:
        try:
            os.remove(PENDING)
        except Exception:
            pass
        return None

    def add(field, val):
        lst = cfg.get(field) or []
        if val and val not in lst:
            lst.append(val)
            cfg[field] = lst

    p = prompt.lower()
    emit = None
    if p in NEVER:
        add("dismissed", key)
    elif p in YES:
        add("adopted", key)
        emit = {"hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": _expand_context(
                key, pend.get("surface") or "capability",
                (pend.get("signature") or {}).get("shape", "")),
        }}
    elif p in NO:
        add("declined", key)
    else:
        cd = {k: v for k, v in (cfg.get("cooldown") or {}).items() if _fresh(v)}
        cd[key] = round(time.time(), 1)
        cfg["cooldown"] = cd

    tmp = CONFIG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
    os.replace(tmp, CONFIG)
    try:
        os.remove(PENDING)
    except Exception:
        pass
    return emit


def main() -> None:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        prompt = str(data.get("prompt", "") or data.get("user_prompt", "") or "").strip()
        if not prompt:
            return  # couldn't read the reply -> fail safe
        cfg = _load_config()

        emit = None
        if os.path.exists(PENDING):
            emit = _handle_pending_answer(prompt, cfg)

        # log the user's own intent (the primary proactive signal), unless off
        if cfg.get("enabled", True) and not cfg.get("quiet", False):
            sig = _intent_sig(prompt)
            if sig:
                _log_intent(sig)

        if emit:
            try:
                print(json.dumps(emit))
            except Exception:
                pass
    except Exception:
        pass  # never break prompt submission
    finally:
        sys.exit(0)


if __name__ == "__main__":
    main()
