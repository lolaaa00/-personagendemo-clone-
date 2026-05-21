# ═══════════════════════════════════════════════════════════════
# PersonaGen — One-Command Deploy Script
# Usage: .\deploy.ps1 [-m "commit message"] [-skip-commit]
# ═══════════════════════════════════════════════════════════════

param(
    [string]$m = "",
    [switch]$skipCommit = $false
)

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

Write-Host ""
Write-Host "  ⚡ PersonaGen Deploy" -ForegroundColor Cyan
Write-Host "  ───────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── Step 1: Git commit & push ──
if (-not $skipCommit) {
    Set-Location $projectDir
    $status = git status --porcelain
    if ($status) {
        if (-not $m) {
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
            $m = "deploy: auto-commit $timestamp"
        }
        Write-Host "  [1/3] Committing changes..." -ForegroundColor Yellow
        git add -A
        git commit -m $m
        Write-Host "  [1/3] ✓ Committed: $m" -ForegroundColor Green
    } else {
        Write-Host "  [1/3] ✓ Working tree clean — nothing to commit" -ForegroundColor Green
    }

    Write-Host "  [2/3] Pushing to GitHub..." -ForegroundColor Yellow
    git push origin main 2>&1
    Write-Host "  [2/3] ✓ Pushed to origin/main" -ForegroundColor Green
} else {
    Write-Host "  [1/3] ⊘ Skipped (--skip-commit)" -ForegroundColor DarkGray
    Write-Host "  [2/3] ⊘ Skipped (--skip-commit)" -ForegroundColor DarkGray
}

# ── Step 2: Deploy to Cloudflare Pages ──
Write-Host "  [3/3] Deploying to Cloudflare Pages..." -ForegroundColor Yellow

# Check for CLOUDFLARE_API_TOKEN
$token = $env:CLOUDFLARE_API_TOKEN
if (-not $token) {
    # Try loading from .env file
    $envFile = Join-Path $projectDir ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*CLOUDFLARE_API_TOKEN\s*=\s*(.+)$') {
                $env:CLOUDFLARE_API_TOKEN = $matches[1].Trim('"').Trim("'")
                $token = $env:CLOUDFLARE_API_TOKEN
            }
        }
    }
}

if (-not $token) {
    Write-Host ""
    Write-Host "  ⚠  CLOUDFLARE_API_TOKEN not set." -ForegroundColor Red
    Write-Host "  Create one at: https://dash.cloudflare.com/profile/api-tokens" -ForegroundColor Yellow
    Write-Host "  Template: 'Edit Cloudflare Workers' (includes Pages)" -ForegroundColor Yellow
    Write-Host "  Then either:" -ForegroundColor DarkGray
    Write-Host "    1. Set env var: `$env:CLOUDFLARE_API_TOKEN = 'your-token'" -ForegroundColor DarkGray
    Write-Host "    2. Create .env file with: CLOUDFLARE_API_TOKEN=your-token" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Git commit + push completed. Site will update when token is configured." -ForegroundColor Yellow
    exit 0
}

$deployDir = Join-Path $projectDir "dist/honeyforx"
npx -y wrangler pages deploy $deployDir --project-name personagendemo --branch main --commit-dirty=true 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [3/3] ✓ Live at https://personagendemo.pages.dev/" -ForegroundColor Green
} else {
    Write-Host "  [3/3] ✗ Deploy failed — check wrangler output above" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  ✅ Deploy complete!" -ForegroundColor Green
Write-Host "  🌐 https://personagendemo.pages.dev/" -ForegroundColor Cyan
Write-Host ""
