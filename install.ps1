# iesens installer (Windows / PowerShell)
# Copies the skill into ~/.claude/skills/iesens and seeds the config.
# Hook wiring (PostToolUse + Stop) is done separately via the update-config skill,
# so this installer never blind-edits settings.json.

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$skillDst = Join-Path $env:USERPROFILE ".claude\skills\iesens"
$cfgDir   = Join-Path $env:USERPROFILE ".claude\iesens"

Write-Host "Installing iesens..."

# 1. Skill (the /iesens brain + references)
New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
Copy-Item (Join-Path $src "SKILL.md") $skillDst -Force
Copy-Item (Join-Path $src "references") $skillDst -Recurse -Force
Write-Host "  - skill  -> $skillDst"

# 2. Config + local state dir (seed config only if absent, to preserve toggles)
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$cfgDst = Join-Path $cfgDir "config.json"
if (-not (Test-Path $cfgDst)) {
    Copy-Item (Join-Path $src "iesens.config.json") $cfgDst -Force
    Write-Host "  - config -> $cfgDst"
} else {
    Write-Host "  - config -> kept existing $cfgDst"
}

Write-Host ""
Write-Host "iesens installed. Run /iesens in any Claude Code session."
Write-Host "To enable the ambient nudges, wire these hooks (via the update-config skill):"
Write-Host "  PostToolUse      -> python `"$src\hooks\watcher.py`""
Write-Host "  Stop             -> python `"$src\hooks\coach_pass.py`""
Write-Host "  UserPromptSubmit -> python `"$src\hooks\learn.py`""
