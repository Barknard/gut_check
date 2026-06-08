# iesens

**A capability coach for Claude Code that teaches, then does.**

Nobody knows every Claude Code capability — and the moment you learn one, you use
it. iesens closes that gap. It watches how you actually work, notices the native
capability you're underusing, teaches it in plain language, shows you **how others
use it**, and on a single "yes" **sets it up for you**. The name is the spec:
*iesens* is *sensei* rearranged — a teacher that guides you toward mastery and can
demonstrate by doing. The goal is your growing independence: every nudge should
make you a little more capable, so over time you reach for it less.

## The contract: observe → expand → or vanish

A nudge never blocks you. First just **one plain-language line** naming what you
keep doing and the payoff; only if you opt in does it **teach** (what / why / how),
show **how others do it**, and lay out a small menu. Ignore it and it vanishes.

```
💡 noticed you keep running `git push --tags` by hand — it could be one saved command.
   Would you like to know more?  (yes / no / or just keep working)

  → on "yes":  a 2–4 line lesson + one real "how others do it" example + a menu
               (save it as a command · make a skill · just explain · never suggest this)
  → on anything else:  it vanishes, and your message is handled normally
```

Two things make it more than the "do-X-with-AI" guides:

1. **It does the work.** On "yes" it writes the memory file, scaffolds the skill,
   or wires the hook — not just advice.
2. **It's grounded in real usage.** Every "how others do it" line is drawn from a
   small, license-aware corpus of real public GitHub usage (facts + a link to the
   actual repo — it never fabricates a citation or reproduces unlicensed prose).

It is useful at **N=1** (a single user, zero network).

## What's wired

- **`/iesens`** — an on-demand review: it surfaces the single highest-leverage
  capability you're missing as a one-line observation (expand on "yes"). Also
  where you manage toggles and ask it to "turn how I do X into a skill". The
  in-session path can reason across all six surfaces:
  `memory · skills · subagents · hooks · slash commands · MCP`.
- **Ambient hooks** (privacy-safe, fail-open):
  - `watcher.py` (PostToolUse) records a privacy-safe command *signature*
    (program + subcommands + flags only — never arguments, messages, paths, or
    file contents) and learns which capabilities you already use, by behavior.
  - `coach_pass.py` (Stop) surfaces one nudge when you repeat a real command
    enough times — naming the actual command, gated so it never repeats what
    you've adopted or declined.
  - `learn.py` (UserPromptSubmit) records your **yes / no / never** into the
    relevance-gate ledgers and triggers the teach-then-do flow on "yes".
  - Today the ambient layer fires on **repeated shell commands**; the other
    surfaces are surfaced through the in-session `/iesens` path.
- **Relevance gate** — never repeats a suggestion you've adopted (observed from
  behavior) or declined; only surfaces net-new, real gains.

## Install

```powershell
# from this folder
./install.ps1     # copies the skill to ~/.claude/skills/iesens, seeds config
```

Then run `/iesens` in any Claude Code session. To enable the ambient nudges, wire
the three hooks (via the `update-config` skill, which never blind-edits settings):

```
PostToolUse      -> python <repo>/hooks/watcher.py
Stop             -> python <repo>/hooks/coach_pass.py
UserPromptSubmit -> python <repo>/hooks/learn.py
```

## Config

`iesens.config.json` (also at `~/.claude/iesens/config.json`): enable/disable,
per-detector sensitivity, `quiet`, `max_suggestions_per_turn`, and the
relevance-gate ledgers (`adopted` / `declined` / `dismissed`). Observed-in-use
surfaces are tracked in `~/.claude/iesens/adopted_surfaces.json`.

## Privacy

The local usage log stores only a coarse, sanitized signature of each action —
program + subcommands + flags for shell commands, a file extension for edits.
Never your arguments, commit messages, paths, secrets, or file contents, and
nothing leaves your machine. (A future opt-in "collective" tier would share only
aggregated, anonymized signals — never code or commands.)

## Tests

```
python tests/test_learning.py      # the learning loop (ledgers, gate, adoption)
python tests/test_audit_fixes.py   # privacy + denoise + yes-bridge regressions
python tests/sim_session.py        # a full multi-turn session simulation
python tests/test_corpus.py        # the "how others do it" corpus ingester
```

## Extend it

New detectors are the growth path. Copy `references/detectors/_template.md`, fill
in {signal, lesson, how-others, executor}, and add its key to
`iesens.config.json`. Keep each one small and single-purpose.

## Status

v0, built for one user first. The skill + the ambient learning loop are wired and
tested; broader packaging/distribution is next.

## License

MIT — see [`LICENSE`](LICENSE).
