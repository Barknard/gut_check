# Detector template

An iesens detector is a small, single-purpose unit: notice one thing, teach one
thing, do one thing. Keeping them small is what keeps the teaching crisp and the
nudges rare. Copy this file, fill the three sections, and add the detector's key
to `detectors` in `iesens.config.json`.

```
key: my_detector_name        # snake_case; matches the config key
```

## Signal — what to notice
Describe the observable trigger as concretely as possible. Good signals are
specific ("the user runs the same git stash → edit → pop sequence 3+ times")
not vague ("the user seems inefficient"). State any threshold (e.g. min_repeats)
and what should NOT trigger it (avoid false positives — a noisy detector gets
toggled off and never comes back).

## Lesson — what to teach
The plain-English what / why / how, ~2–4 lines. Explain the *why* in this
situation, not just the feature's existence. Write for a smart person who simply
hasn't met this capability yet. No condescension, no jargon-before-plain-English.

## Executor — what to do on "yes"
The exact, correct action. Reuse existing conventions and skills rather than
reinventing (e.g. `skill-creator` for skills, `update-config` for settings/hooks,
the in-use memory convention for facts). Finish by telling the user what you did
and where, in one line, so the lesson lands.

---

### Design notes
- One idea per detector. If the lesson needs more than ~4 lines, split it.
- Prefer the highest-leverage, lowest-friction nudge available at a given moment.
- Always honor the `adopted` / `declined` / `dismissed` ledgers and the
  per-detector `enabled` flag.
- The whole point is the user's growing independence — write the lesson so they
  could do it themselves next time.
