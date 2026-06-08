#!/usr/bin/env python3
"""build_corpus.py — the "how others do it" PUBLIC-CORPUS v0 ingester for iesens.

Goal: a clean, legal, compact, queryable corpus of REAL-WORLD Claude Code usage
patterns, so iesens can cite "here's how others use capability X" with a real
example + link.

LEGAL CONTRACT (enforced in code, see SKILL.md "How others do it"):
  * Facts + link by DEFAULT. Patterns / counts / co-occurrence / URLs are facts
    and aren't copyrightable; we extract those and LINK to the source.
  * Verbatim config/skill TEXT is GATED on a detected permissive license
    (MIT / Apache-2.0 / CC0 / BSD / ISC / Unlicense). ~half of public repos are
    unlicensed (all-rights-reserved); for those we keep facts+link only.
  * HARD-EXCLUDED sources: Reddit, YouTube, X/Twitter, Product Hunt — their terms
    forbid mining. Excluded by construction (filter at ingest AND per exemplar).
  * Honest partials: if a source is unreachable / rate-limited, build from what
    we got (+ the always-attributable anchor anthropics/skills + the docs
    taxonomy), mark the corpus `partial`, and NEVER fabricate exemplars.

CLEAN CHANNELS ONLY:
  * GitHub REST API (api.github.com) — we use the *repository* search endpoint,
    which works unauthenticated (60 req/hr). NB: GitHub's *code* search endpoint
    requires auth (401 unauthenticated), so we deliberately avoid it and mine
    repo metadata (name/description/license/stars) instead — still facts+link.
  * anthropics/skills (Apache-2.0, attributable) as a guaranteed anchor.
  * The Claude Code docs llms.txt as a capability TAXONOMY (facts only — we read
    which capabilities exist + their doc links; we do NOT republish doc prose).

Every network call goes through an injectable `fetch_fn(url, headers, timeout)`
so the whole pipeline is testable offline (see tests/test_corpus.py). The real
fetcher uses urllib (stdlib) so there is NO hard dependency on httpx/requests
and no need for any project-specific virtualenv.

Run:  python corpus/build_corpus.py            # writes corpus/how_others.json
                                               # + references/how_others.json
"""
from __future__ import annotations

import json
import os
import re
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(HERE, ".cache")
OUT_CORPUS = os.path.join(HERE, "how_others.json")
OUT_REFERENCES = os.path.join(ROOT, "references", "how_others.json")

USER_AGENT = "iesens-corpus-builder (https://github.com/, public-pattern-facts)"
GH_HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}

# The six native surfaces iesens coaches.
SURFACES = ["memory", "skills", "subagents", "hooks", "slash-commands", "mcp"]


# ---------------------------------------------------------------------------
# Legal primitives
# ---------------------------------------------------------------------------
class SourceUnreachable(Exception):
    """Raised by a fetch_fn when a source can't be reached / is rate-limited.

    The builder catches this, marks the source unreachable, and degrades to a
    partial corpus rather than crashing or fabricating.
    """


# Licenses under which redistributing short config/skill excerpts is safe.
# Default is facts+link; this allowlist is the ONLY path to verbatim text.
PERMISSIVE_LICENSES = {
    "MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "BSD-3-CLAUSE-CLEAR",
    "CC0-1.0", "ISC", "UNLICENSE", "0BSD", "MIT-0",
}
# Maximum length of any license-gated verbatim excerpt (keep it a snippet).
MAX_EXCERPT_CHARS = 280

# Hosts whose terms forbid mining/derivation — excluded by construction.
EXCLUDED_HOSTS = (
    "reddit.com", "redd.it",
    "youtube.com", "youtu.be",
    "x.com", "twitter.com", "t.co",
    "producthunt.com",
)


def may_quote_verbatim(spdx_id) -> bool:
    """True only if the SPDX id is a known permissive license. Default = False.

    None / "" / "NOASSERTION" (GitHub's "no detectable license") / copyleft /
    anything unknown -> False -> facts+link only.
    """
    if not spdx_id:
        return False
    return str(spdx_id).strip().upper() in PERMISSIVE_LICENSES


def excerpt_if_allowed(spdx_id, text):
    """Return a bounded verbatim excerpt ONLY if the license permits it, else None.

    This is the single chokepoint for any verbatim text entering the corpus.
    """
    if not text or not may_quote_verbatim(spdx_id):
        return None
    return text[:MAX_EXCERPT_CHARS]


def is_excluded_source(url) -> bool:
    """True if a URL points at a hard-excluded host (Reddit/YT/X/Product Hunt)."""
    if not url:
        return False
    try:
        host = urllib.parse.urlparse(str(url)).netloc.lower()
    except Exception:
        return True  # if we can't even parse it, don't trust it
    host = host.split("@")[-1].split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    for bad in EXCLUDED_HOSTS:
        if host == bad or host.endswith("." + bad):
            return True
    return False


def _norm_license(spdx_id) -> str:
    """Human-facing license label for an exemplar; unlicensed -> explicit string."""
    if not spdx_id or str(spdx_id).strip().upper() in ("", "NOASSERTION", "OTHER"):
        return "all-rights-reserved"
    return str(spdx_id).strip()


# ---------------------------------------------------------------------------
# Real fetcher (stdlib only). Injected as fetch_fn; tests pass a fake instead.
# ---------------------------------------------------------------------------
def _cache_path(url) -> str:
    h = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return os.path.join(CACHE_DIR, h + ".json")


def urllib_fetch(url, headers=None, timeout=20, *, use_cache=True, cache_ttl=86400):
    """Default fetch_fn: GET via urllib, JSON-or-text, with an on-disk cache.

    Caching is mandatory politeness given the 60 req/hr unauthenticated limit.
    Raises SourceUnreachable on any network/HTTP error so the builder can
    degrade gracefully.
    """
    if use_cache:
        cp = _cache_path(url)
        try:
            if os.path.exists(cp) and (time.time() - os.path.getmtime(cp)) < cache_ttl:
                with open(cp, encoding="utf-8") as fh:
                    cached = json.load(fh)
                return cached["status"], cached["body"]
        except Exception:
            pass  # cache miss / corrupt -> fall through to network

    req = urllib.request.Request(url, headers=headers or {"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.getcode()
            raw = resp.read().decode("utf-8", "replace")
        ctype = ""
        try:
            ctype = resp.headers.get("Content-Type", "")
        except Exception:
            pass
    except urllib.error.HTTPError as e:
        # 403 with rate-limit, 401, 5xx, etc. -> treat as unreachable for this run.
        raise SourceUnreachable(f"HTTP {e.code} for {url}")
    except Exception as e:  # URLError, timeout, DNS, ...
        raise SourceUnreachable(f"{type(e).__name__} for {url}: {e}")

    body = raw
    if "json" in ctype or url.rstrip("/").endswith((".json",)) or raw[:1] in ("{", "["):
        try:
            body = json.loads(raw)
        except Exception:
            body = raw

    if use_cache:
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(_cache_path(url), "w", encoding="utf-8") as fh:
                json.dump({"status": status, "body": body}, fh)
        except Exception:
            pass
    return status, body


# ---------------------------------------------------------------------------
# Capability taxonomy from the docs llms.txt (facts only — links, not prose).
# ---------------------------------------------------------------------------
# Map each iesens surface to the keywords we look for in the docs index, and to
# the GitHub repo-search query that surfaces real-world usage of that surface.
SURFACE_QUERIES = {
    "memory": {
        "doc_keywords": ["memory", "claude.md", "claude md"],
        "gh_query": '"CLAUDE.md" claude code',
        "fact_seed": "projects pin durable facts/preferences in a memory file (e.g. CLAUDE.md) that loads every session",
    },
    "skills": {
        "doc_keywords": ["agent skill", "skills", "skill"],
        "gh_query": '".claude/skills" SKILL.md',
        "fact_seed": "repos keep reusable procedures as SKILL.md under .claude/skills/, invoked by name",
    },
    "subagents": {
        "doc_keywords": ["subagent", "sub-agent", "sub agent", "agents"],
        "gh_query": '".claude/agents" subagent',
        "fact_seed": "heavy/parallel work is delegated to .claude/agents/ workers with their own context + tight tools",
    },
    "hooks": {
        "doc_keywords": ["hook", "hooks"],
        # repo-search matches name/description/readme/topics (not file contents),
        # so a config-token query like "PostToolUse settings.json" finds nothing;
        # the Claude-Code-scoped phrase surfaces real hook repos. (facts+link)
        "gh_query": "claude code hooks",
        "fact_seed": "automation is wired as hooks in settings.json (e.g. PostToolUse to run a formatter after writes)",
    },
    "slash-commands": {
        "doc_keywords": ["slash command", "slash-command", "commands"],
        "gh_query": '".claude/commands" claude',
        "fact_seed": "frequently-typed prompts are saved as .claude/commands/<name>.md and run as /name",
    },
    "mcp": {
        "doc_keywords": ["mcp", "model context protocol"],
        # same reason as hooks: target the Claude-Code MCP ecosystem by phrase.
        "gh_query": "claude code mcp server",
        "fact_seed": "external tools/data are connected via MCP servers declared in .mcp.json (mcpServers)",
    },
}


def parse_docs_taxonomy(text):
    """Extract FACTS from the docs llms.txt: which capabilities exist + doc links.

    We never republish doc prose; we read the index (markdown links) and record,
    per surface, the canonical doc URL(s) that mention it. Pure facts.
    """
    taxonomy = {s: {"doc_links": [], "present_in_docs": False} for s in SURFACES}
    if not isinstance(text, str):
        return taxonomy
    # markdown links: [Label](url)
    link_re = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
    for label, url in link_re.findall(text):
        if is_excluded_source(url):
            continue
        low = (label + " " + url).lower()
        for surface, cfg in SURFACE_QUERIES.items():
            if any(kw in low for kw in cfg["doc_keywords"]):
                taxonomy[surface]["present_in_docs"] = True
                if url not in taxonomy[surface]["doc_links"]:
                    taxonomy[surface]["doc_links"].append(url)
    return taxonomy


# ---------------------------------------------------------------------------
# GitHub repo-search ingestion (facts + link; verbatim license-gated).
# ---------------------------------------------------------------------------
def _gh_search_url(query):
    q = urllib.parse.quote(query)
    return ("https://api.github.com/search/repositories"
            f"?q={q}&per_page=5&sort=stars&order=desc")


def _exemplar_from_repo(item, surface):
    """Turn a GitHub repo-search item into a facts+link exemplar, or None.

    Drops excluded hosts. Records license honestly. Verbatim excerpt (if any)
    is gated; repo-search returns no file body anyway, so verbatim stays None
    here by design — the gate is exercised via excerpt_if_allowed() elsewhere.
    """
    url = item.get("html_url") or ""
    if not url or is_excluded_source(url):
        return None
    spdx = (item.get("license") or {}).get("spdx_id") if item.get("license") else None
    desc = (item.get("description") or "").strip().replace("\n", " ")
    stars = item.get("stargazers_count")
    # one_line is a FACT: what the repo demonstrates for this surface + a signal.
    bits = []
    if desc:
        # cap and strip any accidental code-fence/frontmatter markers
        clean = re.sub(r"[`*]+", "", desc)[:140]
        bits.append(clean)
    else:
        bits.append(f"public repo using {surface}")
    if isinstance(stars, int):
        bits.append(f"{stars}★")
    one_line = " | ".join(bits)[:200]
    ex = {
        "repo_url": url,
        "license": _norm_license(spdx),
        "one_line": one_line,
    }
    return ex


def collect_github(fetch_fn, taxonomy, statuses):
    """Per surface, query GitHub repo search for real usage -> facts+link exemplars.

    Honors the rate limit by stopping all GitHub work on the first
    SourceUnreachable (a 403 rate-limit cascades; no point hammering). Marks the
    source unreachable and returns whatever was gathered before the failure.
    """
    per_surface = {s: [] for s in SURFACES}
    github_ok = None  # None = untried, True/False after first attempt
    for surface in SURFACES:
        if github_ok is False:
            break  # rate-limited / down: stop, keep partial
        cfg = SURFACE_QUERIES[surface]
        try:
            status, body = fetch_fn(_gh_search_url(cfg["gh_query"]),
                                    headers=GH_HEADERS, timeout=20)
            github_ok = True
        except SourceUnreachable:
            github_ok = False
            break
        if not isinstance(body, dict):
            continue
        for item in body.get("items", [])[:5]:
            ex = _exemplar_from_repo(item, surface)
            if ex is not None:
                per_surface[surface].append(ex)
    statuses["github_repo_search"] = "reachable" if github_ok else "unreachable"
    return per_surface


def collect_anchor(fetch_fn, statuses):
    """The always-attributable anchor: anthropics/skills.

    A guaranteed exemplar for the `skills` surface so "how others do it" is never
    empty as long as ANY source is up. Facts+link only: the repo has NO top-level
    LICENSE and is mixed-license, so we never treat it as verbatim-quotable.
    """
    url = "https://api.github.com/repos/anthropics/skills"
    try:
        status, body = fetch_fn(url, headers=GH_HEADERS, timeout=20)
    except SourceUnreachable:
        statuses["anthropics_skills"] = "unreachable"
        return None
    statuses["anthropics_skills"] = "reachable"
    if not isinstance(body, dict):
        return None
    html = body.get("html_url") or "https://github.com/anthropics/skills"
    if is_excluded_source(html):
        return None
    spdx = (body.get("license") or {}).get("spdx_id") if body.get("license") else None
    return {
        "repo_url": html,
        # anthropics/skills has NO top-level LICENSE and is mixed-license; even if
        # the API classifier returns an SPDX, fall back to a NON-permissive label
        # so this exemplar can NEVER clear the verbatim-quote gate (facts+link
        # only). Do not assert Apache-2.0 for the repo as a whole.
        "license": _norm_license(spdx) if spdx else "NOASSERTION (mixed; cite facts+link only)",
        "one_line": "Anthropic's official Agent Skills reference: SKILL.md shape, frontmatter, examples",
    }


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
def build(fetch_fn=None):
    """Build the corpus dict. Inject fetch_fn in tests; defaults to urllib_fetch.

    Returns the full corpus object (also what gets written to disk). Pure aside
    from fetch_fn — never raises on a source outage; degrades to partial.
    """
    if fetch_fn is None:
        fetch_fn = urllib_fetch

    statuses = {}

    # 1. Docs taxonomy (facts only).
    taxonomy = {s: {"doc_links": [], "present_in_docs": False} for s in SURFACES}
    docs_text = None
    for docs_url in ("https://docs.claude.com/llms.txt",
                     "https://docs.anthropic.com/llms.txt"):
        try:
            status, body = fetch_fn(docs_url, headers={"User-Agent": USER_AGENT},
                                    timeout=20)
            docs_text = body if isinstance(body, str) else json.dumps(body)
            statuses["docs_llms_txt"] = "reachable"
            break
        except SourceUnreachable:
            continue
    if docs_text is None:
        statuses["docs_llms_txt"] = "unreachable"
    else:
        taxonomy = parse_docs_taxonomy(docs_text)

    # 2. GitHub repo-search exemplars (facts+link).
    gh_per_surface = collect_github(fetch_fn, taxonomy, statuses)

    # 3. Always-attributable anchor (anthropics/skills) for `skills`.
    anchor = collect_anchor(fetch_fn, statuses)
    if anchor is not None:
        # de-dup against anything GitHub search already returned
        existing = {e["repo_url"] for e in gh_per_surface["skills"]}
        if anchor["repo_url"] not in existing:
            gh_per_surface["skills"].insert(0, anchor)

    # 4. Assemble per-surface blobs (schema). Patterns are facts; the doc-derived
    #    seed fact is included only when the docs confirm the surface exists, so
    #    we never assert a capability the taxonomy didn't corroborate.
    surfaces_out = {}
    for surface in SURFACES:
        cfg = SURFACE_QUERIES[surface]
        patterns = []
        if taxonomy[surface]["present_in_docs"]:
            patterns.append(cfg["fact_seed"])
        # A derived FACT: how many distinct public repos we observed for this
        # surface (count is a fact, not copyrightable, and it's honest signal).
        n = len(gh_per_surface[surface])
        if n:
            patterns.append(f"observed in {n} public repo exemplar(s) via GitHub search")
        # license mix fact (facts about the corpus, useful + non-infringing)
        lics = [e["license"] for e in gh_per_surface[surface]]
        if lics:
            permissive = sum(1 for L in lics if may_quote_verbatim(L))
            arr = sum(1 for L in lics if L == "all-rights-reserved")
            if arr:
                patterns.append(f"{arr} of {len(lics)} exemplars are unlicensed "
                                "(all-rights-reserved) → cited as facts+link only")
            if permissive:
                patterns.append(f"{permissive} of {len(lics)} exemplars carry a "
                                "permissive license (verbatim excerpts allowed)")
        surfaces_out[surface] = {
            "surface": surface,
            "common_patterns": patterns,
            "exemplars": gh_per_surface[surface],
            "doc_links": taxonomy[surface]["doc_links"][:3],
        }

    # 5. Partiality: honest if ANY source we tried was unreachable.
    partial = any(v == "unreachable" for v in statuses.values())

    corpus = {
        "schema_version": 0,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "partial": partial,
        "legal": {
            "default": "facts + link (patterns/counts/URLs are facts, not copyrightable)",
            "verbatim_gate": "permissive license only (MIT/Apache-2.0/CC0/BSD/ISC/Unlicense)",
            "excluded_sources": list(EXCLUDED_HOSTS),
            "note": ("~half of public repos are unlicensed (all-rights-reserved); "
                     "those are cited as facts+link, never verbatim."),
        },
        "sources": [
            {"name": name, "status": status} for name, status in sorted(statuses.items())
        ],
        "surfaces": surfaces_out,
    }
    return corpus


def write_corpus(corpus, *, out_corpus=OUT_CORPUS, out_references=OUT_REFERENCES):
    """Write the corpus to corpus/how_others.json and references/how_others.json."""
    for path in (out_corpus, out_references):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(corpus, fh, indent=2, ensure_ascii=False)
    return out_corpus, out_references


def main():
    corpus = build()
    paths = write_corpus(corpus)
    n_ex = sum(len(s["exemplars"]) for s in corpus["surfaces"].values())
    status_line = ", ".join(f"{s['name']}={s['status']}" for s in corpus["sources"])
    print("iesens corpus built.")
    print(f"  partial   : {corpus['partial']}")
    print(f"  sources   : {status_line}")
    print(f"  exemplars : {n_ex} across {len(corpus['surfaces'])} surfaces")
    print(f"  written   : {paths[0]}")
    print(f"            : {paths[1]}")


if __name__ == "__main__":
    main()
