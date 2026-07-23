#!/usr/bin/env python3
"""Deterministic multi-turn SIMULATION through the real iesens hooks, USER-INPUT
FIRST. The user's repeated REQUESTS drive the primary nudge; a genuinely repeated
command in the work surfaces as a help offer at a higher bar; Claude's mechanical
activity never nudges. Run: python tests/sim_session.py
"""
import json, os, subprocess, sys, tempfile, shutil
from pathlib import Path

HOOKS = Path(__file__).resolve().parent.parent / "hooks"
PY = sys.executable
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
FAILS = []

home = Path(tempfile.mkdtemp())
D = home / ".claude" / "iesens"; D.mkdir(parents=True)
(D / "config.json").write_text(json.dumps(
    {"enabled": True, "detectors": {"skill": {"enabled": True, "min_repeats": 3}},
     "adopted": [], "declined": [], "dismissed": []}))
ENV = dict(os.environ)
ENV.update({"USERPROFILE": str(home), "HOME": str(home), "HOMEDRIVE": str(home)[:2], "HOMEPATH": str(home)[2:] or "\\"})


def hook(name, obj):
    return subprocess.run([PY, str(HOOKS / name)], input=json.dumps(obj), text=True, capture_output=True, env=ENV)


def user(text):
    return hook("learn.py", {"prompt": text})


def cmd(c):
    hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": c}})


def stop():
    p = hook("coach_pass.py", {})
    try:
        return json.loads(p.stdout.strip()).get("systemMessage", "")
    except Exception:
        return ""


def cfg():
    return json.loads((D / "config.json").read_text(encoding="utf-8"))


def ck(label, cond, extra=""):
    print(("  PASS " if cond else "  FAIL ") + label + ("" if cond else "  :: " + str(extra)))
    if not cond:
        FAILS.append(label)


print("TURN A — user asks 'run the tests' 3 times, then Claude stops")
for _ in range(3):
    user("run the tests")
m = stop(); print("   nudge:", m or "(none)")
ck("A_user_intent_nudge", "you keep asking me to `run tests`" in m)
ck("A_not_accusatory_about_claude", "you keep running" not in m)

print("TURN B — user says 'no'")
user("no")
ck("B_intent_declined", "user_intent::run tests" in cfg().get("declined", []))

print("TURN C — user asks 'run the tests' 3 more times -> SILENT (declined)")
for _ in range(3):
    user("run the tests")
m = stop(); print("   nudge:", m or "(none)")
ck("C_declined_silent", m == "")

print("TURN D — Claude runs `docker compose up -d` 4x doing the work -> help-offer nudge (higher bar)")
for _ in range(4):
    cmd("docker compose up -d")
m = stop(); print("   nudge:", m or "(none)")
ck("D_command_help_offer", "`docker compose up -d` keeps coming up" in m)
ck("D_framed_as_help_not_accusation", "you keep running" not in m)

print("TURN E — user says 'yes' -> adopted + expand flow injected")
p = user("yes")
ck("E_command_adopted", "repetition::Bash::docker compose up -d" in cfg().get("adopted", []))
ck("E_expand_context_injected", "hookSpecificOutput" in p.stdout and "docker compose up -d" in p.stdout)

print("TURN F — Claude runs docker again 4x -> SILENT (adopted)")
for _ in range(4):
    cmd("docker compose up -d")
m = stop(); print("   nudge:", m or "(none)")
ck("F_adopted_silent", m == "")

print("\nFINAL ledgers:", json.dumps(cfg()))
shutil.rmtree(home, ignore_errors=True)
print("\n%d failures" % len(FAILS))
sys.exit(1 if FAILS else 0)
