#!/usr/bin/env python3
"""End-to-end tests for the iesens LEARNING loop: watcher (explicit-but-safe
command signature + adoption to its own file), coach_pass (denoise + per-key
relevance gate + names the ACTUAL command), and learn.py (exact yes/no/never ->
ledgers, pending freshness, single config writer). Each hook runs as a real
subprocess against a throwaway HOME so the real ~/.claude/iesens is untouched.
Run: python tests/test_learning.py
"""
import json, os, subprocess, sys, tempfile, shutil, time
from pathlib import Path

HOOKS = Path(__file__).resolve().parent.parent / "hooks"
PY = sys.executable
FAILS = []
GITKEY = "repetition::Bash::git push --tags"


def run_hook(name, stdin_obj, home):
    env = dict(os.environ)
    env["USERPROFILE"] = str(home)
    env["HOME"] = str(home)
    env["HOMEDRIVE"] = str(home)[:2]
    env["HOMEPATH"] = str(home)[2:] or "\\"
    return subprocess.run([PY, str(HOOKS / name)], input=json.dumps(stdin_obj),
                          text=True, capture_output=True, env=env)


def setup_home():
    home = Path(tempfile.mkdtemp())
    d = home / ".claude" / "iesens"
    d.mkdir(parents=True)
    cfg = {"enabled": True, "detectors": {"skill": {"enabled": True, "min_repeats": 3}},
           "adopted": [], "declined": [], "dismissed": []}
    (d / "config.json").write_text(json.dumps(cfg))
    return home, d


def cfg_of(d):
    return json.loads((d / "config.json").read_text(encoding="utf-8"))


def write_usage(d, events):
    now = time.time()
    with open(d / "usage.jsonl", "w", encoding="utf-8") as fh:
        for t, s in events:
            fh.write(json.dumps({"ts": round(now, 1), "tool": t, "shape": s}) + "\n")


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        FAILS.append(name)


def msg_of(p):
    try:
        return json.loads(p.stdout.strip()).get("systemMessage", "")
    except Exception:
        return ""


def last_shape(d):
    return json.loads((d / "usage.jsonl").read_text(encoding="utf-8").splitlines()[-1])["shape"]


def _pending(d, key=GITKEY, surface="skill", age=0):
    (d / "pending.json").write_text(json.dumps(
        {"key": key, "surface": surface, "ts": round(time.time() - age, 1)}))


# --- watcher: explicit-but-safe command signature ---
def t_watcher_cmd_sig_keeps_flags():
    home, d = setup_home()
    run_hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "git push --tags"}}, home)
    check("watcher_cmd_sig_keeps_flags", last_shape(d) == "git push --tags", last_shape(d))
    shutil.rmtree(home, ignore_errors=True)


def t_watcher_cmd_sig_drops_secrets():
    home, d = setup_home()
    run_hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": 'git commit -m "my secret release note"'}}, home)
    check("watcher_cmd_sig_drops_secret_msg", last_shape(d) == "git commit -m", last_shape(d))
    shutil.rmtree(home, ignore_errors=True)


def t_watcher_cmd_sig_stops_at_path():
    home, d = setup_home()
    run_hook("watcher.py", {"tool_name": "Bash", "tool_input": {"command": "cat /etc/secrets/key.pem"}}, home)
    check("watcher_cmd_sig_stops_at_path", last_shape(d) == "cat", last_shape(d))
    shutil.rmtree(home, ignore_errors=True)


# --- watcher: adoption to its own file (M1 fix) ---
def t_watcher_adopts_to_own_file():
    home, d = setup_home()
    run_hook("watcher.py", {"tool_name": "Write", "tool_input": {
        "file_path": str(home / ".claude" / "skills" / "foo" / "SKILL.md")}}, home)
    surf = json.loads((d / "adopted_surfaces.json").read_text())["surfaces"] if (d / "adopted_surfaces.json").exists() else []
    check("watcher_adopts_to_own_file", "skill" in surf, surf)
    check("watcher_does_not_touch_config_adopted", cfg_of(d)["adopted"] == [], cfg_of(d)["adopted"])
    shutil.rmtree(home, ignore_errors=True)


# --- coach_pass: fires on a real repeated command and NAMES it explicitly ---
def t_coach_names_actual_command():
    home, d = setup_home()
    write_usage(d, [("Bash", "git push --tags")] * 4)
    p = run_hook("coach_pass.py", {}, home)
    m = msg_of(p)
    check("coach_fires_pending", (d / "pending.json").exists())
    check("coach_names_actual_command", "`git push --tags`" in m, m)
    check("coach_says_benefit", "saved command" in m, m)
    check("coach_msg_invite", "Would you like to know more?" in m, m)
    shutil.rmtree(home, ignore_errors=True)


def t_coach_ignores_noise():
    home, d = setup_home()
    write_usage(d, [("Read", ".md")] * 12 + [("Grep", "search")] * 12 + [("Bash", "cd")] * 12)
    p = run_hook("coach_pass.py", {}, home)
    check("coach_ignores_noise", p.stdout.strip() == "" and not (d / "pending.json").exists(), repr(p.stdout))
    shutil.rmtree(home, ignore_errors=True)


def t_coach_gate_key_adopted_silent():
    home, d = setup_home()
    write_usage(d, [("Bash", "git push --tags")] * 4)
    c = cfg_of(d); c["adopted"] = [GITKEY]; (d / "config.json").write_text(json.dumps(c))
    p = run_hook("coach_pass.py", {}, home)
    check("coach_gate_key_adopted_silent", p.stdout.strip() == "", repr(p.stdout))
    shutil.rmtree(home, ignore_errors=True)


def t_coach_surface_adopt_does_not_blanket():
    home, d = setup_home()
    write_usage(d, [("Bash", "git push --tags")] * 4)
    c = cfg_of(d); c["adopted"] = ["skill"]; (d / "config.json").write_text(json.dumps(c))
    p = run_hook("coach_pass.py", {}, home)
    check("coach_surface_adopt_no_blanket", "[iesens] noticed" in msg_of(p), repr(p.stdout))
    shutil.rmtree(home, ignore_errors=True)


def t_coach_gate_declined():
    home, d = setup_home()
    write_usage(d, [("Bash", "git push --tags")] * 4)
    c = cfg_of(d); c["declined"] = [GITKEY]; (d / "config.json").write_text(json.dumps(c))
    p = run_hook("coach_pass.py", {}, home)
    check("coach_gate_declined_silent", p.stdout.strip() == "", repr(p.stdout))
    shutil.rmtree(home, ignore_errors=True)


# --- learn.py: exact yes/no/never; stale/multiword/empty handled safely ---
def t_learn_no_declines():
    home, d = setup_home(); _pending(d)
    run_hook("learn.py", {"prompt": "no"}, home)
    check("learn_no_declines", GITKEY in cfg_of(d)["declined"] and not (d / "pending.json").exists(), cfg_of(d))
    shutil.rmtree(home, ignore_errors=True)


def t_learn_never_dismisses():
    home, d = setup_home(); _pending(d)
    run_hook("learn.py", {"prompt": "never"}, home)
    check("learn_never_dismisses", GITKEY in cfg_of(d)["dismissed"], cfg_of(d))
    shutil.rmtree(home, ignore_errors=True)


def t_learn_yes_adopts_key():
    home, d = setup_home(); _pending(d)
    run_hook("learn.py", {"prompt": "yes"}, home)
    check("learn_yes_adopts_key", GITKEY in cfg_of(d)["adopted"], cfg_of(d))
    shutil.rmtree(home, ignore_errors=True)


def t_learn_multiword_not_captured():
    home, d = setup_home(); _pending(d)
    run_hook("learn.py", {"prompt": "yes go commit that file for me now"}, home)
    c = cfg_of(d)
    check("learn_multiword_not_false_yes", GITKEY not in c.get("adopted", []) and GITKEY in (c.get("cooldown") or {}), c)
    shutil.rmtree(home, ignore_errors=True)


def t_learn_stale_pending_discarded():
    home, d = setup_home(); _pending(d, age=2000)
    run_hook("learn.py", {"prompt": "yes"}, home)
    c = cfg_of(d)
    ok = GITKEY not in c.get("adopted", []) and c.get("declined", []) == [] and not (d / "pending.json").exists()
    check("learn_stale_pending_discarded", ok, c)
    shutil.rmtree(home, ignore_errors=True)


def t_learn_movedon_cooldown_not_declined():
    home, d = setup_home(); _pending(d)
    run_hook("learn.py", {"prompt": "actually fix the failing build in src/api first"}, home)
    c = cfg_of(d)
    ok = GITKEY in (c.get("cooldown") or {}) and GITKEY not in c.get("declined", []) and not (d / "pending.json").exists()
    check("learn_movedon_soft_cooldown", ok, c)
    shutil.rmtree(home, ignore_errors=True)


def t_learn_empty_prompt_failsafe():
    home, d = setup_home(); _pending(d)
    run_hook("learn.py", {"prompt": ""}, home)
    c = cfg_of(d)
    ok = c["declined"] == [] and c["dismissed"] == [] and c["adopted"] == [] and (d / "pending.json").exists()
    check("learn_empty_prompt_failsafe", ok, c)
    shutil.rmtree(home, ignore_errors=True)


def t_learn_noop_without_pending():
    home, d = setup_home()
    run_hook("learn.py", {"prompt": "no"}, home)
    c = cfg_of(d)
    check("learn_noop_without_pending", c["declined"] == [] and c["dismissed"] == [], c)
    shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    for fn in [t_watcher_cmd_sig_keeps_flags, t_watcher_cmd_sig_drops_secrets,
               t_watcher_cmd_sig_stops_at_path, t_watcher_adopts_to_own_file,
               t_coach_names_actual_command, t_coach_ignores_noise,
               t_coach_gate_key_adopted_silent, t_coach_surface_adopt_does_not_blanket,
               t_coach_gate_declined, t_learn_no_declines, t_learn_never_dismisses,
               t_learn_yes_adopts_key, t_learn_multiword_not_captured,
               t_learn_stale_pending_discarded, t_learn_movedon_cooldown_not_declined,
               t_learn_empty_prompt_failsafe, t_learn_noop_without_pending]:
        try:
            fn()
        except Exception as e:
            print("ERROR", fn.__name__, "--", e); FAILS.append(fn.__name__)
    print("\n%d failures" % len(FAILS))
    sys.exit(1 if FAILS else 0)
