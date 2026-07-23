#!/usr/bin/env python3
"""Privacy + denoise regressions for iesens. Two signature paths must never store
a secret, path, or free-text value:
- watcher._cmd_sig (the work signal) — sanitizes even the FIRST command token.
- learn._intent_sig (the user-input signal) — only logs short directives, never a
  prompt containing a path / secret / long token.
Plus the PowerShell + inline-eval + bare-program denoise filters.
Run: python tests/test_audit_fixes.py
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


def last_shape(d):
    return json.loads((d / "usage.jsonl").read_text(encoding="utf-8").splitlines()[-1])["shape"]


def all_shapes(d):
    p = d / "usage.jsonl"
    return [json.loads(l)["shape"] for l in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def intents(d):
    p = d / "user_intents.jsonl"
    return [json.loads(l)["sig"] for l in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def write_usage(d, events):
    now = time.time()
    with open(d / "usage.jsonl", "w", encoding="utf-8") as fh:
        for t, s in events:
            fh.write(json.dumps({"ts": round(now, 1), "tool": t, "shape": s}) + "\n")


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


# --- watcher command signature: first token sanitized; secrets/paths never stored ---
def watcher_cmd_sig():
    home, d = setup()
    run("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "TOKEN=sk-abc123 npm publish"}}, home)
    ck("cmd_env_assign_stripped", last_shape(d) == "npm publish", last_shape(d))
    run("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "PASSWORD=hunter2 ./deploy.sh"}}, home)
    ck("cmd_path_basename_only", last_shape(d) == "deploy.sh", last_shape(d))
    run("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "$(whoami)"}}, home)
    ck("cmd_cmdsubst_redacted", last_shape(d) == "(redacted)", last_shape(d))
    run("watcher.py", {"tool_name": "Bash", "tool_input": {"command": 'git commit -m "secret note"'}}, home)
    ck("cmd_drops_secret_msg", last_shape(d) == "git commit -m", last_shape(d))
    ck("cmd_no_secret_in_any_shape", all("=" not in s and "hunter2" not in s and "sk-abc123" not in s for s in all_shapes(d)), all_shapes(d))
    shutil.rmtree(home, ignore_errors=True)


# --- intent signature: only short directives; never a path/secret/long prompt ---
def intent_sig_privacy():
    home, d = setup()
    run("learn.py", {"prompt": "run the tests"}, home)
    ck("intent_logs_directive", intents(d) == ["run tests"], intents(d))
    run("learn.py", {"prompt": "format src/api.ts with prettier"}, home)
    ck("intent_skips_path", intents(d) == ["run tests"], intents(d))  # unchanged: path prompt not logged
    run("learn.py", {"prompt": "deploy with key=sk-secret-123"}, home)
    ck("intent_skips_secret", intents(d) == ["run tests"], intents(d))  # '=' token -> skipped
    run("learn.py", {"prompt": "please go ahead and refactor the entire auth module to use async tokens now everywhere"}, home)
    ck("intent_skips_long", intents(d) == ["run tests"], intents(d))  # >10 words -> skipped
    shutil.rmtree(home, ignore_errors=True)


# --- denoise ---
def denoise():
    home, d = setup(); write_usage(d, [("Bash", "python")] * 5)
    ck("bare_python_silent", stop(home) == "")
    h2, d2 = setup(); write_usage(d2, [("Bash", "python -c")] * 5)
    ck("inline_eval_silent", stop(h2) == "")
    h3, d3 = setup(); write_usage(d3, [("PowerShell", "docker compose up -d")] * 4)
    ck("powershell_fires", "`docker compose up -d` keeps coming up" in stop(h3))
    h4, d4 = setup(); write_usage(d4, [("PowerShell", "get-childitem")] * 5)
    ck("ps_trivial_silent", stop(h4) == "")
    for h in (home, h2, h3, h4):
        shutil.rmtree(h, ignore_errors=True)


if __name__ == "__main__":
    for fn in [watcher_cmd_sig, intent_sig_privacy, denoise]:
        try:
            fn()
        except Exception as e:
            print("ERROR", fn.__name__, "--", e); FAILS.append(fn.__name__)
    print("\n%d failures" % len(FAILS))
    sys.exit(1 if FAILS else 0)
