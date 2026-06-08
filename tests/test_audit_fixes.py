#!/usr/bin/env python3
"""Regression tests for the audit fixes:
A1 first-token privacy, B1 yes->expand bridge, B2 signature-collapse guard,
B3 PowerShell support, C1 inline-eval noise, C2 one-outstanding-nudge throttle.
Each hook runs as a real subprocess against a throwaway HOME.
Run: python tests/test_audit_fixes.py
"""
import json, os, subprocess, sys, tempfile, shutil, time
from pathlib import Path

HOOKS = Path(__file__).resolve().parent.parent / "hooks"
PY = sys.executable
FAILS = []


def run_hook(name, obj, home):
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
def lastshape(d): return json.loads((d / "usage.jsonl").read_text(encoding="utf-8").splitlines()[-1])["shape"]


def usage(d, events):
    now = time.time()
    with open(d / "usage.jsonl", "w", encoding="utf-8") as fh:
        for t, s in events:
            fh.write(json.dumps({"ts": round(now, 1), "tool": t, "shape": s}) + "\n")


def stopmsg(home):
    p = run_hook("coach_pass.py", {}, home)
    try:
        return json.loads(p.stdout.strip()).get("systemMessage", "")
    except Exception:
        return ""


def ck(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  :: " + str(x)))
    if not c:
        FAILS.append(n)


# A1 — first command token sanitized; secrets/paths never stored
def a1_first_token():
    home, d = setup()
    run_hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "TOKEN=sk-abc123 npm publish"}}, home)
    ck("A1_env_assign_stripped", lastshape(d) == "npm publish", lastshape(d))
    run_hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "PASSWORD=hunter2 ./deploy.sh"}}, home)
    ck("A1_path_basename_only", lastshape(d) == "deploy.sh", lastshape(d))
    run_hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "$(whoami)"}}, home)
    ck("A1_cmdsubst_redacted", lastshape(d) == "(redacted)", lastshape(d))
    shapes = [json.loads(l)["shape"] for l in (d / "usage.jsonl").read_text(encoding="utf-8").splitlines()]
    ck("A1_no_secret_in_any_shape", all("=" not in s and "hunter2" not in s and "sk-abc123" not in s for s in shapes), shapes)
    shutil.rmtree(home, ignore_errors=True)


def a1_coach_skips_tainted():
    home, d = setup(); usage(d, [("Bash", "PASSWORD=hunter2")] * 4)
    ck("A1_coach_skips_tainted", stopmsg(home) == "")
    shutil.rmtree(home, ignore_errors=True)


# B2 — bare collapsed program does not nudge; a real sub-command does
def b2_collapse():
    home, d = setup(); usage(d, [("Bash", "python")] * 4)
    ck("B2_bare_python_silent", stopmsg(home) == "")
    home2, d2 = setup(); usage(d2, [("Bash", "npm run build")] * 4)
    ck("B2_real_subcmd_fires", "`npm run build`" in stopmsg(home2))
    shutil.rmtree(home, ignore_errors=True); shutil.rmtree(home2, ignore_errors=True)


# B3 — PowerShell is supported; PS noise verbs are filtered
def b3_powershell():
    home, d = setup(); usage(d, [("PowerShell", "docker compose up -d")] * 4)
    ck("B3_powershell_fires", "`docker compose up -d`" in stopmsg(home))
    home2, d2 = setup(); usage(d2, [("PowerShell", "get-childitem")] * 4)
    ck("B3_ps_trivial_silent", stopmsg(home2) == "")
    shutil.rmtree(home, ignore_errors=True); shutil.rmtree(home2, ignore_errors=True)


# C1 — inline-eval probes are not nudged
def c1_inline_eval():
    home, d = setup(); usage(d, [("Bash", "python -c")] * 5)
    ck("C1_inline_eval_silent", stopmsg(home) == "")
    shutil.rmtree(home, ignore_errors=True)


# C2 — one outstanding nudge at a time
def c2_throttle():
    home, d = setup(); usage(d, [("Bash", "git push --tags")] * 4)
    (d / "pending.json").write_text(json.dumps(
        {"key": "repetition::Bash::npm run build", "surface": "skill", "ts": round(time.time(), 1)}))
    ck("C2_throttle_one_outstanding", stopmsg(home) == "")
    shutil.rmtree(home, ignore_errors=True)


# B1 — 'yes' injects the expand-flow context AND records adoption
def b1_yes_bridge():
    home, d = setup()
    (d / "pending.json").write_text(json.dumps(
        {"key": "repetition::Bash::git push --tags", "surface": "skill",
         "signature": {"shape": "git push --tags"}, "ts": round(time.time(), 1)}))
    p = run_hook("learn.py", {"prompt": "yes"}, home)
    out = p.stdout
    ok = ("hookSpecificOutput" in out and "additionalContext" in out
          and "git push --tags" in out and "repetition::Bash::git push --tags" in out)
    ck("B1_yes_emits_expand_context", ok, out[:200])
    ck("B1_yes_still_adopts", "repetition::Bash::git push --tags" in cfg(d)["adopted"])
    shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    for fn in [a1_first_token, a1_coach_skips_tainted, b2_collapse, b3_powershell,
               c1_inline_eval, c2_throttle, b1_yes_bridge]:
        try:
            fn()
        except Exception as e:
            print("ERROR", fn.__name__, "--", e); FAILS.append(fn.__name__)
    print("\n%d failures" % len(FAILS))
    sys.exit(1 if FAILS else 0)
