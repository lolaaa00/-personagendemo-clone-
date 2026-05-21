# ═══════════════════════════════════════════════════════════════
# PersonaGen — One-Command Deploy Script
# Usage: .\deploy.ps1 [-m "commit message"] [-skipCommit]
# ═══════════════════════════════════════════════════════════════

param(
    [string]$m = "",
    [switch]$skipCommit = $false
)

$ErrorActionPreference = "Continue"
$projectDir = $PSScriptRoot

Write-Host ""
Write-Host "  [Deploy] PersonaGen Deploy" -ForegroundColor Cyan
Write-Host "  -----------------------" -ForegroundColor DarkGray
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
        Write-Host "  [1/3] OK Committed: $m" -ForegroundColor Green
    } else {
        Write-Host "  [1/3] OK Working tree clean - nothing to commit" -ForegroundColor Green
    }

    Write-Host "  [2/3] Pushing to GitHub..." -ForegroundColor Yellow
    git push origin main
    Write-Host "  [2/3] OK Pushed to origin/main" -ForegroundColor Green
} else {
    Write-Host "  [1/3] Skipped (skip-commit)" -ForegroundColor DarkGray
    Write-Host "  [2/3] Skipped (skip-commit)" -ForegroundColor DarkGray
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
    Write-Host "  [Info] CLOUDFLARE_API_TOKEN not set. Attempting deployment using local Wrangler authentication session..." -ForegroundColor Gray
}

$deployDir = Join-Path $projectDir "dist/honeyforx"
npx -y wrangler pages deploy $deployDir --project-name personagendemo --branch main --commit-dirty=true
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [3/3] OK Live at https://personagendemo.pages.dev/" -ForegroundColor Green
} else {
    Write-Host "  [3/3] ERROR Deploy failed - check wrangler output above" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  🌐 https://personagendemo.pages.dev/" -ForegroundColor Cyan
Write-Host ""
