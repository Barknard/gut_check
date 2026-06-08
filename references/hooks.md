# iesens hooks — the ambient layer (wired)

The `/iesens` skill works on its own (the user runs it and gets a review). The
hooks add the *proactive* layer: iesens notices patterns as you work and surfaces
a gentle nudge without being asked. Three tiny scripts, wired via Claude Code's
hooks in `settings.json` (always through the `update-config` skill — never a blind
hand-edit).

## 1. watcher — `hooks/watcher.py`  (PostToolUse)
Runs after each tool call. Reads the hook's JSON from stdin and records only a
**privacy-safe command signature** — program + subcommands + flag names (e.g.
`git push --tags`), never argument *values*, file contents, or full paths — and
appends one line to `~/.claude/iesens/usage.jsonl`. It also records observed
capability *adoption* (which native surfaces it sees the user already using) to
`~/.claude/iesens/adopted_surfaces.json`, so the relevance gate can suppress
nudges for surfaces already in use.

Privacy is load-bearing: just enough to spot repetition, nothing reconstructable.
It must be fast and must never fail a tool call — any error exits 0 silently.

## 2. coach_pass — `hooks/coach_pass.py`  (Stop)
Runs when Claude finishes a response — a natural pause, not mid-task. It reads the
recent tail of `usage.jsonl`, runs the **enabled** detectors (respecting
`iesens.config.json` and the `adopted` / `declined` / `dismissed` ledgers), and if
a clear pattern fires, writes the opportunity to `~/.claude/iesens/pending.json`
and prints one concise nudge line.

Surfacing contract (verify against the installed Claude Code version when wiring):
the nudge reaches the user either via the Stop hook's stdout or by iesens reading
`pending.json` on the next turn (e.g. a UserPromptSubmit/SessionStart hook, or the
`/iesens` command). The pending-file path is the robust fallback so a suggestion
is never lost if stdout isn't surfaced.

## 3. learn — `hooks/learn.py`
Records the user's response to a surfaced nudge into the relevance-gate ledgers:
a "yes" → `adopted`, a "no"/"not now" → `declined`, a "never" → `dismissed`. This
is what makes the gate durable: once recorded, that suggestion is not re-surfaced.

## Wiring (done, via `update-config`)
In `settings.json` hooks:
- `PostToolUse` → `python <iesens>/hooks/watcher.py`
- `Stop` → `python <iesens>/hooks/coach_pass.py`
- learn.py is invoked to record yes/no/never on a nudge.

Keep all three cheap and non-blocking. The watcher should add single-digit
milliseconds; the coach pass only reads a bounded tail of the log.

## Restraint
The ambient layer lives or dies on not being annoying: at most
`max_suggestions_per_turn`, never an `adopted` / `declined` / `dismissed` item,
never mid-crisis, and a hard respect for `quiet: true`. A muted coach teaches no
one.
