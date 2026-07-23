#!/usr/bin/env python3
"""Tests for the iesens learning loop under the USER-INPUT-FIRST model:
- learn.py logs a privacy-safe signature of short USER directives (the primary
  signal) and records yes/no/never into the gate ledgers (+ yes-bridge).
- coach_pass.py surfaces repeated USER REQUESTS first, then genuine command
  time-savers at a HIGHER bar (framed as a help offer, never "you keep running X").
- watcher.py learns adoption by behavior.
Each hook runs as a real subprocess against a throwaway HOME.
Run: python tests/test_learning.py
"""
import json, os, subprocess, sys, tempfile, shutil, time
from pathlib import Path

HOOKS = Path(__file__).resolve().parent.parent / "hooks"
PY = sys.executable
FAILS = []


def run(name, obj, home):
    env = dict(os.environ)
    env.update({"USERPROFILE": str(home), "HOME": str(home),
                "HOMEDRIVE": str(home)[:2], "HOMEPATH": str(home)[2:] or "\\"})
    return subprocess.run([PY, str(HOOKS / name)], input=json.dumps(obj),
                          text=True, capture_output=True, env=env)


def setup():
    home = Path(tempfile.mkdtemp()); d = home / ".claude" / "iesens"; d.mkdir(parents=True)
    (d / "config.json").write_text(json.dumps(
        {"enabled": True, "detectors": {"skill": {"enabled": True, "min_repeats": 3}},
         "adopted": [], "declined": [], "dismissed": []}))
    return home, d


def cfg(d): return json.loads((d / "config.json").read_text(encoding="utf-8"))


def intents(d):
    p = d / "user_intents.jsonl"
    return [json.loads(l)["sig"] for l in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def write_usage(d, events):
    now = time.time()
    with open(d / "usage.jsonl", "w", encoding="utf-8") as fh:
        for t, s in events:
            fh.write(json.dumps({"ts": round(now, 1), "tool": t, "shape": s}) + "\n")


def write_intents(d, sigs):
    now = time.time()
    with open(d / "user_intents.jsonl", "w", encoding="utf-8") as fh:
        for s in sigs:
            fh.write(json.dumps({"ts": round(now, 1), "sig": s}) + "\n")


def stop(home):
    p = run("coach_pass.py", {}, home)
    try:
        return json.loads(p.stdout.strip()).get("systemMessage", "")
    except Exception:
        return ""


def ck(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  :: " + str(x)))
    if not c:
        FAILS.append(n)


# --- learn: USER intent logging (privacy-safe, primary signal) ---
def t_intent_logs_directive():
    home, d = setup(); run("learn.py", {"prompt": "run the tests"}, home)
    ck("intent_logs_directive", intents(d) == ["run tests"], intents(d)); shutil.rmtree(home, ignore_errors=True)


def t_intent_bang_command():
    home, d = setup(); run("learn.py", {"prompt": "!git push --tags"}, home)
    ck("intent_bang_command", intents(d) == ["git push --tags"], intents(d)); shutil.rmtree(home, ignore_errors=True)


def t_intent_skips_thin_answer():
    home, d = setup(); run("learn.py", {"prompt": "yes"}, home)
    ck("intent_skips_thin", intents(d) == [], intents(d)); shutil.rmtree(home, ignore_errors=True)


# --- coach: USER intent nudge fires first ---
def t_coach_user_intent_nudge():
    home, d = setup(); write_intents(d, ["run tests"] * 3)
    ck("coach_intent_fires", "you keep asking me to `run tests`" in stop(home)); shutil.rmtree(home, ignore_errors=True)


# --- coach: command at a HIGHER bar, reframed as a help offer ---
def t_coach_command_higher_bar():
    home, d = setup(); write_usage(d, [("Bash", "git push --tags")] * 3)
    ck("coach_cmd_below_bar_silent", stop(home) == "")  # 3 < command_min(4)
    home2, d2 = setup(); write_usage(d2, [("Bash", "git push --tags")] * 4)
    m = stop(home2)
    ck("coach_cmd_at_bar_fires", "`git push --tags` keeps coming up" in m, m)
    ck("coach_cmd_not_accusatory", "you keep running" not in m, m)
    shutil.rmtree(home, ignore_errors=True); shutil.rmtree(home2, ignore_errors=True)


# --- coach: USER intent takes priority over a command signal ---
def t_coach_intent_priority():
    home, d = setup(); write_intents(d, ["run tests"] * 3); write_usage(d, [("Bash", "git push --tags")] * 6)
    ck("coach_intent_priority", "you keep asking me to `run tests`" in stop(home)); shutil.rmtree(home, ignore_errors=True)


# --- coach: noise never nudges ---
def t_coach_noise():
    home, d = setup(); write_usage(d, [("Read", ".md")] * 12 + [("Bash", "cd")] * 12 + [("Bash", "python")] * 12 + [("Bash", "python -c")] * 12)
    ck("coach_noise_silent", stop(home) == ""); shutil.rmtree(home, ignore_errors=True)


# --- gate ---
def t_gate_intent_declined():
    home, d = setup(); write_intents(d, ["run tests"] * 3)
    c = cfg(d); c["declined"] = ["user_intent::run tests"]; (d / "config.json").write_text(json.dumps(c))
    ck("gate_intent_declined", stop(home) == ""); shutil.rmtree(home, ignore_errors=True)


def t_gate_command_adopted():
    home, d = setup(); write_usage(d, [("Bash", "git push --tags")] * 5)
    c = cfg(d); c["adopted"] = ["repetition::Bash::git push --tags"]; (d / "config.json").write_text(json.dumps(c))
    ck("gate_command_adopted", stop(home) == ""); shutil.rmtree(home, ignore_errors=True)


def t_throttle():
    home, d = setup(); write_intents(d, ["run tests"] * 3)
    (d / "pending.json").write_text(json.dumps({"key": "x", "ts": round(time.time(), 1)}))
    ck("throttle_one_outstanding", stop(home) == ""); shutil.rmtree(home, ignore_errors=True)


# --- learn: yes/no/never/cooldown + yes-bridge ---
def _pending(d, key="user_intent::run tests", surface="slash_command", shape="run tests", age=0):
    (d / "pending.json").write_text(json.dumps(
        {"key": key, "surface": surface, "signature": {"shape": shape}, "ts": round(time.time() - age, 1)}))


def t_yes_adopts_and_emits():
    home, d = setup(); _pending(d)
    p = run("learn.py", {"prompt": "yes"}, home)
    ck("yes_adopts", "user_intent::run tests" in cfg(d)["adopted"])
    ck("yes_emits_expand", "hookSpecificOutput" in p.stdout and "run tests" in p.stdout, p.stdout[:160])
    shutil.rmtree(home, ignore_errors=True)


def t_no_declines():
    home, d = setup(); _pending(d); run("learn.py", {"prompt": "no"}, home)
    ck("no_declines", "user_intent::run tests" in cfg(d)["declined"]); shutil.rmtree(home, ignore_errors=True)


def t_never_dismisses():
    home, d = setup(); _pending(d); run("learn.py", {"prompt": "never"}, home)
    ck("never_dismisses", "user_intent::run tests" in cfg(d)["dismissed"]); shutil.rmtree(home, ignore_errors=True)


def t_movedon_cooldown():
    home, d = setup(); _pending(d); run("learn.py", {"prompt": "look at the failing build instead"}, home)
    c = cfg(d)
    ck("movedon_cooldown", "user_intent::run tests" in (c.get("cooldown") or {}) and "user_intent::run tests" not in c.get("declined", []), c)
    shutil.rmtree(home, ignore_errors=True)


def t_stale_pending():
    home, d = setup(); _pending(d, age=2000); run("learn.py", {"prompt": "yes"}, home)
    ck("stale_discarded", "user_intent::run tests" not in cfg(d)["adopted"] and not (d / "pending.json").exists())
    shutil.rmtree(home, ignore_errors=True)


def t_watcher_adoption():
    home, d = setup()
    run("watcher.py", {"tool_name": "Write", "tool_input": {"file_path": str(home / ".claude" / "skills" / "x" / "SKILL.md")}}, home)
    surf = json.loads((d / "adopted_surfaces.json").read_text())["surfaces"] if (d / "adopted_surfaces.json").exists() else []
    ck("watcher_adoption", "skill" in surf, surf); shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    for fn in [t_intent_logs_directive, t_intent_bang_command, t_intent_skips_thin_answer,
               t_coach_user_intent_nudge, t_coach_command_higher_bar, t_coach_intent_priority,
               t_coach_noise, t_gate_intent_declined, t_gate_command_adopted, t_throttle,
               t_yes_adopts_and_emits, t_no_declines, t_never_dismisses, t_movedon_cooldown,
               t_stale_pending, t_watcher_adoption]:
        try:
            fn()
        except Exception as e:
            print("ERROR", fn.__name__, "--", e); FAILS.append(fn.__name__)
    print("\n%d failures" % len(FAILS))
    sys.exit(1 if FAILS else 0)
