#!/usr/bin/env python3
"""TDD spec for corpus/build_corpus.py — the "how others do it" PUBLIC-CORPUS v0.

These tests are the contract. The ingester must:
  (a) extract FACTS (patterns/counts/URLs), not verbatim config text;
  (b) gate verbatim excerpts on a detected permissive license (MIT/Apache/CC0);
  (c) produce the documented compact schema, per surface;
  (d) exclude Reddit / YouTube / X / Product Hunt by construction;
  (e) degrade gracefully (partial corpus, no fabrication) when a source is
      unreachable.

The module is written so every network boundary is injectable: tests pass a
fake `fetch_fn` and never touch the real network.

Run:  python -m pytest tests/test_corpus.py -v
  or: python tests/test_corpus.py        (built-in runner, no pytest needed)
"""
import os
import sys
import json
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "corpus"))

import build_corpus as bc  # noqa: E402


# ----------------------------------------------------------------------------
# Fakes: a fetch_fn the module calls. We route by URL substring so a single
# fake can simulate repo-search, the licenses API, the docs llms.txt, etc.
# A fetch_fn returns (status:int, body) where body is dict (json) or str (text),
# or raises bc.SourceUnreachable to simulate an outage / rate-limit.
# ----------------------------------------------------------------------------

FAKE_REPO_SEARCH = {
    "total_count": 2,
    "items": [
        {
            "full_name": "alice/claude-skills-demo",
            "html_url": "https://github.com/alice/claude-skills-demo",
            "description": "Demo of .claude/skills/ for code review and releases",
            "stargazers_count": 142,
            "license": {"spdx_id": "MIT", "key": "mit"},
        },
        {
            "full_name": "bob/private-prompts",
            "html_url": "https://github.com/bob/private-prompts",
            "description": "My personal .claude/skills/ collection",
            "stargazers_count": 9,
            "license": None,  # all-rights-reserved -> facts+link only
        },
    ],
}

FAKE_LICENSE_UNLICENSED = {
    # licenses API for a repo with no detectable license
    "license": {"spdx_id": "NOASSERTION", "key": "other"},
}

# A snippet of "skill text" that an over-eager ingester might try to copy.
VERBATIM_SKILL_TEXT = (
    "---\nname: review\ndescription: gate on diff size and emit a rubric\n---\n"
    "# Review\nStep 1: read the diff. Step 2: apply the fixed rubric...\n"
)

FAKE_DOCS_LLMS = (
    "# Claude docs\n"
    "- [Agent Skills](https://docs.claude.com/agent-skills.md) - Skills\n"
    "- [Subagents](https://docs.claude.com/sub-agents.md) - Subagents\n"
    "- [Hooks](https://docs.claude.com/hooks.md) - Hooks in settings.json\n"
    "- [MCP](https://docs.claude.com/mcp.md) - Model Context Protocol\n"
    "- [Memory](https://docs.claude.com/memory.md) - Memory\n"
    "- [Slash commands](https://docs.claude.com/slash-commands.md) - Commands\n"
)


def make_fetch(*, github_ok=True, docs_ok=True):
    """Build a fake fetch_fn. Flip flags to simulate unreachable sources."""

    def fetch(url, headers=None, timeout=None):
        u = url.lower()
        if "api.github.com/search/repositories" in u:
            if not github_ok:
                raise bc.SourceUnreachable("github down")
            return 200, dict(FAKE_REPO_SEARCH)
        if "api.github.com/repos/" in u and u.endswith("/license"):
            if not github_ok:
                raise bc.SourceUnreachable("github down")
            return 200, dict(FAKE_LICENSE_UNLICENSED)
        if "llms.txt" in u or "docs.claude.com" in u or "docs.anthropic.com" in u:
            if not docs_ok:
                raise bc.SourceUnreachable("docs down")
            return 200, FAKE_DOCS_LLMS
        if "api.github.com/repos/anthropics/skills" in u:
            return 200, {"full_name": "anthropics/skills",
                         "html_url": "https://github.com/anthropics/skills",
                         "description": "Public repository for Agent Skills",
                         "license": {"spdx_id": "Apache-2.0", "key": "apache-2.0"}}
        raise bc.SourceUnreachable("unexpected url: " + url)

    return fetch


SURFACES = {"memory", "skills", "subagents", "hooks", "slash-commands", "mcp"}


# ----------------------------------------------------------------------------
# (c) Schema
# ----------------------------------------------------------------------------
class TestSchema(unittest.TestCase):
    def test_schema_shape_per_surface(self):
        corpus = bc.build(fetch_fn=make_fetch())
        self.assertIn("generated_at", corpus)
        self.assertIn("partial", corpus)
        self.assertIn("sources", corpus)
        self.assertIn("surfaces", corpus)
        # Every documented surface present, each with the compact schema.
        for surface in SURFACES:
            self.assertIn(surface, corpus["surfaces"], f"missing surface {surface}")
            blob = corpus["surfaces"][surface]
            self.assertEqual(blob["surface"], surface)
            self.assertIsInstance(blob["common_patterns"], list)
            self.assertIsInstance(blob["exemplars"], list)
            for fact in blob["common_patterns"]:
                self.assertIsInstance(fact, str)
            for ex in blob["exemplars"]:
                self.assertIn("repo_url", ex)
                self.assertIn("license", ex)
                self.assertIn("one_line", ex)

    def test_json_serializable(self):
        corpus = bc.build(fetch_fn=make_fetch())
        # Must round-trip cleanly to the on-disk artifact.
        json.loads(json.dumps(corpus))


# ----------------------------------------------------------------------------
# (a) Facts, not verbatim
# ----------------------------------------------------------------------------
class TestFactsNotVerbatim(unittest.TestCase):
    def test_exemplars_are_facts_and_links(self):
        corpus = bc.build(fetch_fn=make_fetch())
        for surface in SURFACES:
            for ex in corpus["surfaces"][surface]["exemplars"]:
                # A one-liner FACT, not a config dump: short + no skill body.
                self.assertLessEqual(len(ex["one_line"]), 200)
                self.assertNotIn("Step 1:", ex["one_line"])
                self.assertNotIn("---\nname:", ex["one_line"])
                self.assertTrue(ex["repo_url"].startswith("http"))

    def test_no_verbatim_skill_body_anywhere(self):
        corpus = bc.build(fetch_fn=make_fetch())
        blob = json.dumps(corpus)
        # The unlicensed skill body must never appear in the corpus.
        self.assertNotIn("Step 1: read the diff", blob)
        self.assertNotIn(VERBATIM_SKILL_TEXT, blob)


# ----------------------------------------------------------------------------
# (b) Verbatim is license-gated
# ----------------------------------------------------------------------------
class TestLicenseGate(unittest.TestCase):
    def test_permissive_allows_excerpt(self):
        self.assertTrue(bc.may_quote_verbatim("MIT"))
        self.assertTrue(bc.may_quote_verbatim("Apache-2.0"))
        self.assertTrue(bc.may_quote_verbatim("CC0-1.0"))
        self.assertTrue(bc.may_quote_verbatim("BSD-3-Clause"))

    def test_unlicensed_or_unknown_blocks_excerpt(self):
        self.assertFalse(bc.may_quote_verbatim(None))
        self.assertFalse(bc.may_quote_verbatim(""))
        self.assertFalse(bc.may_quote_verbatim("NOASSERTION"))
        self.assertFalse(bc.may_quote_verbatim("GPL-3.0"))  # copyleft: not safe to redistribute config
        self.assertFalse(bc.may_quote_verbatim("UNKNOWN"))

    def test_excerpt_helper_respects_gate(self):
        # An unlicensed repo: helper must return None (no excerpt), not the text.
        self.assertIsNone(bc.excerpt_if_allowed(None, VERBATIM_SKILL_TEXT))
        self.assertIsNone(bc.excerpt_if_allowed("NOASSERTION", VERBATIM_SKILL_TEXT))
        # A permissive repo: helper may return a (bounded) excerpt.
        out = bc.excerpt_if_allowed("MIT", VERBATIM_SKILL_TEXT)
        self.assertIsNotNone(out)
        self.assertIn(out, VERBATIM_SKILL_TEXT)

    def test_unlicensed_exemplar_marked_all_rights_reserved(self):
        corpus = bc.build(fetch_fn=make_fetch())
        # bob/private-prompts had license=None -> must be facts+link, labeled.
        found = None
        for ex in corpus["surfaces"]["skills"]["exemplars"]:
            if "bob/private-prompts" in ex["repo_url"]:
                found = ex
        self.assertIsNotNone(found, "unlicensed exemplar should still be kept (facts+link)")
        self.assertEqual(found["license"], "all-rights-reserved")
        self.assertNotIn("verbatim", found)


# ----------------------------------------------------------------------------
# (d) Excluded sources by construction
# ----------------------------------------------------------------------------
class TestExcludedSources(unittest.TestCase):
    def test_excluded_hosts_constant(self):
        for host in ("reddit.com", "youtube.com", "youtu.be", "x.com",
                     "twitter.com", "producthunt.com"):
            self.assertTrue(bc.is_excluded_source("https://www." + host + "/foo"),
                            f"{host} must be excluded")

    def test_clean_hosts_allowed(self):
        self.assertFalse(bc.is_excluded_source("https://github.com/alice/x"))
        self.assertFalse(bc.is_excluded_source("https://docs.claude.com/x"))

    def test_excluded_urls_never_enter_corpus(self):
        # Even if a fetch returned a poisoned exemplar, the builder filters it.
        poisoned = {
            "total_count": 1,
            "items": [{
                "full_name": "evil/reddit-mirror",
                "html_url": "https://www.reddit.com/r/ClaudeAI/comments/abc",
                "description": ".claude/skills/ tips",
                "stargazers_count": 999,
                "license": {"spdx_id": "MIT"},
            }],
        }

        def fetch(url, headers=None, timeout=None):
            u = url.lower()
            if "api.github.com/search/repositories" in u:
                return 200, dict(poisoned)
            if "llms.txt" in u or "docs.claude.com" in u:
                return 200, FAKE_DOCS_LLMS
            if "api.github.com/repos/anthropics/skills" in u:
                return 200, {"full_name": "anthropics/skills",
                             "html_url": "https://github.com/anthropics/skills",
                             "license": {"spdx_id": "Apache-2.0"}}
            raise bc.SourceUnreachable(url)

        corpus = bc.build(fetch_fn=fetch)
        # The poisoned exemplar must never appear as a CITED exemplar/pattern.
        # (The corpus legitimately *declares* its excluded hosts in `legal`, so
        # we scan the surfaces payload — where citations live — not that block.)
        cited = json.dumps(corpus["surfaces"])
        self.assertNotIn("reddit.com", cited)
        self.assertNotIn("reddit-mirror", cited)
        for surface in corpus["surfaces"].values():
            for ex in surface["exemplars"]:
                self.assertFalse(bc.is_excluded_source(ex["repo_url"]))


# ----------------------------------------------------------------------------
# (e) Graceful degradation, no fabrication
# ----------------------------------------------------------------------------
class TestGracefulDegradation(unittest.TestCase):
    def test_github_down_still_builds_from_docs_and_anchor(self):
        corpus = bc.build(fetch_fn=make_fetch(github_ok=False))
        self.assertTrue(corpus["partial"], "must be marked partial when a source fails")
        # The schema is still complete (all surfaces present, no crash).
        for surface in SURFACES:
            self.assertIn(surface, corpus["surfaces"])
        # The always-reachable anchor (anthropics/skills) still seeds exemplars.
        all_repo_urls = [
            ex["repo_url"]
            for s in corpus["surfaces"].values()
            for ex in s["exemplars"]
        ]
        self.assertTrue(any("anthropics/skills" in u for u in all_repo_urls),
                        "anchor source should survive a GitHub-search outage")

    def test_no_fabricated_exemplars_when_all_remote_down(self):
        def fetch(url, headers=None, timeout=None):
            # everything is down EXCEPT the locally-known anchor metadata
            if "api.github.com/repos/anthropics/skills" in url.lower():
                return 200, {"full_name": "anthropics/skills",
                             "html_url": "https://github.com/anthropics/skills",
                             "license": {"spdx_id": "Apache-2.0"}}
            raise bc.SourceUnreachable(url)

        corpus = bc.build(fetch_fn=fetch)
        self.assertTrue(corpus["partial"])
        # Every exemplar must come from a real fetched source — never invented.
        for surface in SURFACES:
            for ex in corpus["surfaces"][surface]["exemplars"]:
                self.assertTrue(ex["repo_url"].startswith("http"))
                # No placeholder / example / TODO junk leaking through.
                low = (ex["repo_url"] + ex["one_line"]).lower()
                self.assertNotIn("example.com", low)
                self.assertNotIn("todo", low)
                self.assertNotIn("lorem", low)

    def test_total_outage_does_not_crash_and_is_partial(self):
        def fetch(url, headers=None, timeout=None):
            raise bc.SourceUnreachable("everything down")

        corpus = bc.build(fetch_fn=fetch)
        self.assertTrue(corpus["partial"])
        for surface in SURFACES:
            self.assertIn(surface, corpus["surfaces"])  # schema intact
        # With zero reachable sources there is nothing to honestly cite.
        total_exemplars = sum(len(s["exemplars"]) for s in corpus["surfaces"].values())
        self.assertEqual(total_exemplars, 0, "must not fabricate when nothing is reachable")

    def test_sources_status_recorded_honestly(self):
        corpus = bc.build(fetch_fn=make_fetch(github_ok=False))
        self.assertIn("sources", corpus)
        # Each source carries an honest reachable/unreachable status.
        statuses = {s["name"]: s["status"] for s in corpus["sources"]}
        self.assertIn("github_repo_search", statuses)
        self.assertEqual(statuses["github_repo_search"], "unreachable")


def _load_suite():
    loader = unittest.TestLoader()
    return loader.loadTestsFromModule(sys.modules[__name__])


if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(_load_suite())
    sys.exit(0 if result.wasSuccessful() else 1)
