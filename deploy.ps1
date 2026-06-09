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

# ── Step 2: Build and Deploy SvelteKit App ──
Write-Host "  [3/4] Building SvelteKit App..." -ForegroundColor Yellow

Set-Location (Join-Path $projectDir "personagen-svelte")
npx.cmd -y svelte-kit sync
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [3/4] ERROR SvelteKit Build failed" -ForegroundColor Red
    Set-Location $projectDir
    exit 1
}
Set-Location $projectDir

Write-Host "  [4/4] Deploying SvelteKit to Cloudflare Pages..." -ForegroundColor Yellow

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

$domain = "honeyx.monarchstack.com"
$projectName = "personagen-demo"
Write-Host "  [Info] Resolved deployment target: $domain ($projectName)" -ForegroundColor Gray

# Avoid prompt if multiple Cloudflare accounts exist on local session
if ($projectName -eq "personagen-demo" -and -not $env:CLOUDFLARE_ACCOUNT_ID) {
    $env:CLOUDFLARE_ACCOUNT_ID = "87725a00a89a8442984a809237911244"
}

$deployDir = Join-Path $projectDir "personagen-svelte\.svelte-kit\cloudflare"
npx.cmd -y wrangler pages deploy $deployDir --project-name $projectName --branch main --commit-dirty=true
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [4/4] OK Live at https://$domain/" -ForegroundColor Green
} else {
    Write-Host "  [4/4] ERROR Deploy failed - check wrangler output above" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  🌐 https://$domain/" -ForegroundColor Cyan
Write-Host ""
