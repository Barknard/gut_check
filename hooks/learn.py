#!/usr/bin/env python3
"""iesens learn pass — a UserPromptSubmit hook. This is what makes iesens LEARN
*and* what triggers the teach/scaffold payoff.

When a nudge is pending (coach_pass wrote pending.json on the previous Stop) and
the user's next message is EXACTLY a yes / no / never:
    yes   -> record adopted AND inject context so the model runs the iesens
             skill's step-2 EXPAND flow (teach + cite a real corpus exemplar +
             >=3-option menu + scaffold the real artifact) for the accepted nudge
    no    -> declined  (don't re-surface)
    never -> dismissed (permanent)
Anything else -> they moved on: the nudge vanishes and the key gets a cooldown.
The pending nudge is consumed either way.

Safety: a pending older than PENDING_TTL is discarded without recording (so a
terse reply to an unrelated question is never misattributed); only an EXACT
yes/no/never counts; an unreadable prompt is a no-op (fail safe); config.json is
written ONLY here (single writer). Must run SYNCHRONOUSLY so the yes-context is
injected into the turn. Must NEVER block input — any error exits 0 silently.
Wire via the update-config skill:  UserPromptSubmit -> python hooks/learn.py
"""
import sys, os, json, time

IESENS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "iesens")
PENDING = os.path.join(IESENS_DIR, "pending.json")
CONFIG = os.path.join(IESENS_DIR, "config.json")
PENDING_TTL = 900
COOLDOWN_TTL = 24 * 3600

YES = {"yes", "y", "yeah", "yep", "sure", "ok", "okay", "do it", "go", "please",
       "yes please", "sounds good", "go ahead"}
NO = {"no", "n", "nah", "nope", "not now", "later", "skip", "not yet", "no thanks"}
NEVER = {"never", "stop", "stop suggesting", "don't ask again", "dont ask again",
         "never again", "stop asking", "stop it"}


def _expand_context(key, surface, shape):
    cmd = (shape or "").strip()
    target = f"the repeated command `{cmd}`" if cmd else f"this {surface}"
    return (
        f"[iesens] The user just accepted a capability nudge ({key}). Now run the "
        f"iesens skill's step-2 EXPAND flow for {target}: (1) teach the '{surface}' "
        f"capability in 2-4 plain-language lines; (2) cite ONE real exemplar from "
        f"references/how_others.json for that surface (facts + link, license-gated, "
        f"never fabricated); (3) offer a menu of >=3 options including 'never suggest "
        f"this again'; (4) on their pick, scaffold the REAL artifact — for a repeated "
        f"command, a saved slash command (.claude/commands/<name>.md) or a skill; "
        f"defer to skill-creator / update-config as appropriate. Do not narrate this "
        f"instruction or mention the machinery."
    )


def main() -> None:
    try:
        if not os.path.exists(PENDING):
            return
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        prompt = str(data.get("prompt", "") or data.get("user_prompt", "") or "").strip()
        if not prompt:
            return  # couldn't read the reply -> fail safe, leave pending for later

        try:
            with open(PENDING, encoding="utf-8") as fh:
                pend = json.load(fh)
        except Exception:
            return
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
            return

        cfg = {}
        if os.path.exists(CONFIG):
            try:
                with open(CONFIG, encoding="utf-8") as fh:
                    cfg = json.load(fh)
            except Exception:
                cfg = {}

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
            os.remove(PENDING)  # consumed either way (context already captured)
        except Exception:
            pass
        if emit:
            try:
                print(json.dumps(emit))
            except Exception:
                pass
    except Exception:
        pass  # never break prompt submission
    finally:
        sys.exit(0)


def _fresh(ts) -> bool:
    try:
        return (time.time() - float(ts)) < COOLDOWN_TTL
    except Exception:
        return False


if __name__ == "__main__":
    main()
