# ═══════════════════════════════════════════════════════════════
# PersonaGen — Clean Node/Docker Deployment Pipeline
# Usage: .\deploy.ps1 [-m "commit message"] [-skipTests]
# ═══════════════════════════════════════════════════════════════

param(
    [string]$m = "",
    [switch]$skipTests = $false
)

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

Write-Host ""
Write-Host "  [Deploy] PersonaGen Git-Ops & Verification Pipeline" -ForegroundColor Cyan
Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# ── Step 1: Quality Checks & Tests ──
if (-not $skipTests) {
    Write-Host "  [1/3] Running Type checks & Svelte-Check..." -ForegroundColor Yellow
    Set-Location (Join-Path $projectDir "personagen-svelte")
    
    cmd.exe /c "npm run check"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [1/3] ERROR: Svelte-check failed. Aborting deployment." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
    Write-Host "  [1/3] OK: Code type checks passed." -ForegroundColor Green

    Write-Host "  [1/3] Running Vitest Unit & Integration Tests..." -ForegroundColor Yellow
    cmd.exe /c "npm run test:unit -- --run"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [1/3] ERROR: Unit tests failed. Aborting deployment." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
    Write-Host "  [1/3] OK: All unit and integration tests passed." -ForegroundColor Green
    Set-Location $projectDir
} else {
    Write-Host "  [1/3] Skipped quality and test validations." -ForegroundColor DarkGray
}

# ── Step 2: Stage & Commit ──
Set-Location $projectDir
$status = git status --porcelain
if ($status) {
    if (-not $m) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        $m = "deploy: update & verify $timestamp"
    }
    Write-Host "  [2/3] Committing updated changes..." -ForegroundColor Yellow
    git add -A
    git commit -m $m
    Write-Host "  [2/3] OK Committed: $m" -ForegroundColor Green
} else {
    Write-Host "  [2/3] OK Working tree clean - nothing to commit" -ForegroundColor Green
}

# ── Step 3: Push to GitHub (Triggers Easypanel Docker auto-build) ──
Write-Host "  [3/3] Pushing to GitHub (origin/main)..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [3/3] ERROR: Push failed" -ForegroundColor Red
    exit 1
}
Write-Host "  [3/3] OK Pushed to origin/main" -ForegroundColor Green

Write-Host ""
Write-Host "  Pipeline complete! Pushed to Git." -ForegroundColor Green
Write-Host "  🚀 Easypanel is rebuilding the SvelteKit Node.js/Docker container." -ForegroundColor Cyan
Write-Host ""
