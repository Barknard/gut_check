#!/usr/bin/env python3
"""Deterministic multi-turn SIMULATION of a real developer session through the
ACTUAL iesens hooks (watcher / coach_pass / learn) against a throwaway HOME.
Exercises the full learning arc and asserts behavior at each turn:
fire -> decline -> fire(other) -> adopt -> suppress(declined) -> suppress(adopted)
-> observe-adoption -> new-cmd-not-blanket-silenced -> moved-on cooldown -> suppress(cooldown).
Run: python tests/sim_session.py
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
ENV.update({"USERPROFILE": str(home), "HOME": str(home),
            "HOMEDRIVE": str(home)[:2], "HOMEPATH": str(home)[2:] or "\\"})


def hook(name, obj):
    return subprocess.run([PY, str(HOOKS / name)], input=json.dumps(obj),
                          text=True, capture_output=True, env=ENV)


def bash(cmd):
    hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": cmd}})


def writef(path):
    hook("watcher.py", {"tool_name": "Write", "tool_input": {"file_path": path}})


def stop():
    p = hook("coach_pass.py", {})
    try:
        return json.loads(p.stdout.strip()).get("systemMessage", "")
    except Exception:
        return ""


def reply(text):
    hook("learn.py", {"prompt": text})


def cfg():
    return json.loads((D / "config.json").read_text(encoding="utf-8"))


def ck(label, cond, extra=""):
    print(("  PASS " if cond else "  FAIL ") + label + ("" if cond else "  :: " + str(extra)))
    if not cond:
        FAILS.append(label)


print("TURN 1 — dev runs `npm run build` 4x, then stops")
for _ in range(4):
    bash("npm run build")
m = stop(); print("   nudge:", m or "(none)")
ck("t1_nudge_fires", "npm run build" in m)
ck("t1_explicit_command", "`npm run build`" in m)
ck("t1_invite", "Would you like to know more?" in m)

print("TURN 2 — dev replies 'no'")
reply("no")
ck("t2_npm_declined", "repetition::Bash::npm run build" in cfg().get("declined", []))

print("TURN 3 — dev runs `git push --tags` 4x, stops")
for _ in range(4):
    bash("git push --tags")
m = stop(); print("   nudge:", m or "(none)")
ck("t3_fresh_nudge_on_git", "`git push --tags`" in m)

print("TURN 4 — dev replies 'yes'")
reply("yes")
ck("t4_git_adopted", "repetition::Bash::git push --tags" in cfg().get("adopted", []))

print("TURN 5 — dev runs `npm run build` again -> must be SILENT (declined)")
for _ in range(4):
    bash("npm run build")
m = stop(); print("   nudge:", m or "(none)")
ck("t5_declined_silent", m == "")

print("TURN 6 — dev runs `git push --tags` again -> SILENT (adopted)")
for _ in range(4):
    bash("git push --tags")
m = stop(); print("   nudge:", m or "(none)")
ck("t6_adopted_silent", m == "")

print("TURN 7 — dev writes a skill file (adoption learned by behavior)")
writef(str(home / ".claude" / "skills" / "deploy" / "SKILL.md"))
surf = json.loads((D / "adopted_surfaces.json").read_text())["surfaces"] if (D / "adopted_surfaces.json").exists() else []
ck("t7_skill_surface_learned", "skill" in surf, surf)

print("TURN 8 — dev runs `docker compose up -d` 4x -> FRESH nudge (surface adoption did NOT blanket-silence)")
for _ in range(4):
    bash("docker compose up -d")
m = stop(); print("   nudge:", m or "(none)")
ck("t8_new_cmd_not_blanket_silenced", "`docker compose up -d`" in m)

print("TURN 9 — dev moves on (long unrelated reply) -> cooldown, NOT declined")
reply("actually can you refactor the auth module to use async tokens")
c = cfg()
ck("t9_docker_cooldown", "repetition::Bash::docker compose up -d" in (c.get("cooldown") or {}))
ck("t9_docker_not_declined", "repetition::Bash::docker compose up -d" not in c.get("declined", []))

print("TURN 10 — dev runs `docker compose up -d` again immediately -> SILENT (cooldown)")
for _ in range(4):
    bash("docker compose up -d")
m = stop(); print("   nudge:", m or "(none)")
ck("t10_cooldown_silent", m == "")

print("\nFINAL ledgers:", json.dumps(cfg()))
shutil.rmtree(home, ignore_errors=True)
print("\n%d failures" % len(FAILS))
sys.exit(1 if FAILS else 0)
