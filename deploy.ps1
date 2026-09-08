# ═══════════════════════════════════════════════════════════════
# PersonaGen — Clean Node/Docker Deployment Pipeline
# Usage: .\deploy.ps1 [-m "commit message"] [-skipTests]
# ═══════════════════════════════════════════════════════════════

param(
    [string]$m = "",
    [switch]$skipTests = $false,
    [switch]$integration = $false,
    # Schema and code must not drift: a migration listed in supabase/migrations.json
    # but not recorded in production's schema_migrations aborts the deploy. Pass
    # this only when you have deliberately decided to ship code ahead of schema.
    [switch]$allowPendingMigrations = $false,
    # Untracked files inside the staged scope abort the deploy. A stray scratch
    # file named with a Windows temp path was committed to the repo root this way
    # on 2026-09-05. Pass this when the new files are genuinely meant to ship.
    [switch]$allowUntracked = $false,
    # Skip the eslint gate. Like -skipTests, this is recorded in the commit message.
    [switch]$skipLint = $false,
    # The Model Manager's claims are checked against the LIVE catalog: at most one
    # default per mode, every default wired/active/priced, every route the real
    # resolvers return pointing at a runnable row. Read-only, ~1s. Pass this only
    # when you are deliberately shipping with the catalog in a known-bad state.
    [switch]$allowRegistryDrift = $false,
    # Run every gate and print what WOULD be staged, then stop. Commits nothing,
    # pushes nothing. This is how you test a change to this script.
    [switch]$dryRun = $false
)

# Gates that were bypassed, appended to the commit message so the bypass is
# visible in `git log` forever instead of only in one terminal session.
$bypassed = @()

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

# Every gate below decides on the tool's own exit code. Windows PowerShell turns
# a native command's stderr into ErrorRecords, so with ErrorActionPreference
# "Stop" a single warning line aborts the whole pipeline — and svelte-check, npm
# and vitest all write to stderr on a perfectly healthy run. (Before this helper
# the script died at step 1 every time, right after the gates it had just
# passed.) Run native commands with stderr as plain text and let $LASTEXITCODE
# speak; cmdlet errors keep failing fast, since the preference is restored.
function Invoke-Gate([string]$command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        cmd.exe /c $command 2>&1 | ForEach-Object { Write-Host $_.ToString() }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

Write-Host ""
Write-Host "  [Deploy] PersonaGen Git-Ops & Verification Pipeline" -ForegroundColor Cyan
Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# ── Step 0: Migration ledger must match the code being shipped ──
Set-Location (Join-Path $projectDir "personagen-svelte")
Write-Host "  [0/3] Checking production migration ledger..." -ForegroundColor Yellow
$ledgerExit = Invoke-Gate "node scripts/apply-migration.mjs --status --strict"
if ($ledgerExit -eq 0) {
    # A stamped migration must be a verified one (D12): every 'recorded' file's
    # tables / columns / functions / indexes must exist in the target database.
    $ledgerExit = Invoke-Gate "node scripts/verify-recorded-migrations.mjs --strict"
}
if ($ledgerExit -ne 0) {
    if ($allowPendingMigrations) {
        Write-Host "  [0/3] WARNING: pending/drifted migrations — continuing because -allowPendingMigrations was given." -ForegroundColor DarkYellow
    } else {
        Write-Host "  [0/3] ERROR: pending or drifted migrations. Apply them (node scripts/apply-migration.mjs --all) or pass -allowPendingMigrations." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
} else {
    Write-Host "  [0/3] OK: schema ledger matches migrations.json." -ForegroundColor Green
}

# Registry truth: what the Model Manager claims must match what the resolvers do
# and what the live catalog holds. REGISTRY_TRUTH_STRICT=1 turns "I could not
# reach the database" into a failure — without it the suite skips and exits 0,
# which would let this gate pass having checked nothing.
Write-Host "  [0/3] Checking model registry truth against the live catalog..." -ForegroundColor Yellow
$env:REGISTRY_TRUTH_STRICT = "1"
$registryExit = Invoke-Gate "npx vitest run --project integration"
Remove-Item Env:\REGISTRY_TRUTH_STRICT -ErrorAction SilentlyContinue
if ($registryExit -ne 0) {
    if ($allowRegistryDrift) {
        Write-Host "  [0/3] WARNING: registry truth check failed — continuing because -allowRegistryDrift was given." -ForegroundColor DarkYellow
        $bypassed += "registry-truth"
    } else {
        Write-Host "  [0/3] ERROR: the live model catalog contradicts the code (or could not be read). Fix the catalog on /models, or pass -allowRegistryDrift." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
} else {
    Write-Host "  [0/3] OK: model registry matches the resolvers." -ForegroundColor Green
}
Set-Location $projectDir

# ── Step 1: Quality Checks & Tests ──
Write-Host "  [1/3] Running Type checks & Svelte-Check..." -ForegroundColor Yellow
Set-Location (Join-Path $projectDir "personagen-svelte")

$checkExit = Invoke-Gate "npm run check"
if ($checkExit -ne 0) {
    Write-Host "  [1/3] ERROR: Svelte-check failed. Aborting deployment." -ForegroundColor Red
    Set-Location $projectDir
    exit 1
}
Write-Host "  [1/3] OK: Code type checks passed." -ForegroundColor Green

# ── Stale-state ceiling ──
# `let x = $state(data.foo)` captures the initial value; after a client-side
# navigation to a different record the field is stale. The count may only go
# down — the ceiling lives in scripts/warning-ceilings.json.
Write-Host "  [1/3] Checking svelte warning ceilings..." -ForegroundColor Yellow
$ceilingExit = Invoke-Gate "node scripts/check-warnings-ceiling.mjs"
if ($ceilingExit -ne 0) {
    Write-Host "  [1/3] ERROR: svelte warning ceiling exceeded. Aborting deployment." -ForegroundColor Red
    Set-Location $projectDir
    exit 1
}

# ── Lint ──
# Errors are hard failures; the warning classes are ratcheted by --max-warnings
# in the npm script. Both numbers may only go down.
if (-not $skipLint) {
    Write-Host "  [1/3] Running ESLint..." -ForegroundColor Yellow
    $lintExit = Invoke-Gate "npm run lint:ci"
    if ($lintExit -ne 0) {
        Write-Host "  [1/3] ERROR: Lint failed. Aborting deployment." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
    Write-Host "  [1/3] OK: Lint passed." -ForegroundColor Green
} else {
    Write-Host "  [1/3] WARNING: LINT GATE SKIPPED (-skipLint)." -ForegroundColor Red
    $bypassed += "lint"
}

# ── Production dependency audit ──
# Only --omit=dev and only high/critical: a dev-only or moderate advisory must
# never block a hotfix, but a high in a shipped dependency must.
Write-Host "  [1/3] Auditing production dependencies..." -ForegroundColor Yellow
$auditExit = Invoke-Gate "npm audit --omit=dev --audit-level=high"
if ($auditExit -ne 0) {
    Write-Host "  [1/3] ERROR: high/critical vulnerability in a production dependency." -ForegroundColor Red
    Write-Host "  [1/3]        Fix with: npm audit fix   (then npm install - NEVER pass --omit=dev to audit fix," -ForegroundColor Red
    Write-Host "  [1/3]        it prunes devDependencies out of node_modules)." -ForegroundColor Red
    Set-Location $projectDir
    exit 1
}
Write-Host "  [1/3] OK: No high/critical production advisories." -ForegroundColor Green

# ── Auth preflight ──
# The Admin PIN gate on /signup is only enforceable while the Supabase project
# has public signups disabled: the anon key ships in the browser bundle, so an
# open project can be registered against directly, bypassing the PIN entirely.
Write-Host "  [1/3] Checking auth signup gate..." -ForegroundColor Yellow
# --warn-only comes off once GOTRUE_DISABLE_SIGNUP is flipped on the Supabase project (today it still accepts public signups, so the strict probe exits 1).
$authExit = Invoke-Gate "node scripts/preflight-auth.mjs --warn-only"
if ($authExit -ne 0) {
    Write-Host "  [1/3] ERROR: auth preflight failed. Aborting deployment." -ForegroundColor Red
    Set-Location $projectDir
    exit 1
}

if (-not $skipTests) {
    Write-Host "  [1/3] Running Vitest Unit Tests..." -ForegroundColor Yellow
    $unitExit = Invoke-Gate "npm run test:unit"
    if ($unitExit -ne 0) {
        Write-Host "  [1/3] ERROR: Unit tests failed. Aborting deployment." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
    Write-Host "  [1/3] OK: Unit tests passed." -ForegroundColor Green

    if ($integration) {
        Write-Host "  [1/3] Running Live AI Sequential Integration Tests..." -ForegroundColor Yellow
        $integrationExit = Invoke-Gate "npm run test:integration"
        if ($integrationExit -ne 0) {
            Write-Host "  [1/3] ERROR: Integration tests failed. Aborting deployment." -ForegroundColor Red
            Set-Location $projectDir
            exit 1
        }
        Write-Host "  [1/3] OK: Live AI integration tests passed." -ForegroundColor Green
    } else {
        Write-Host "  [1/3] Skipped live integration tests (run with -integration to enable)." -ForegroundColor DarkGray
    }
} else {
    Write-Host "  [1/3] WARNING: TEST GATE SKIPPED (-skipTests)." -ForegroundColor Red
    $bypassed += "tests"
}
Set-Location $projectDir

# ── Step 2: Stage & Commit ──
Set-Location $projectDir

# Scope of the commit. Anything outside these paths is never staged.
$stageScope = @("personagen-svelte", "docs", "deploy.ps1", "README.md", ".gitignore", "scripts", "services")

# Untracked files inside the scope are surfaced BEFORE staging. `git add -A` on
# a scope still sweeps up whatever happens to be sitting there; that is how a
# 69KB scratch diff named with a Windows temp path reached the repo root.
$untracked = git ls-files --others --exclude-standard -- $stageScope
if ($untracked -and -not $allowUntracked) {
    Write-Host "  [2/3] ERROR: untracked files inside the staged scope:" -ForegroundColor Red
    foreach ($u in $untracked) { Write-Host "          $u" -ForegroundColor Red }
    Write-Host "  [2/3]        Add them to .gitignore, delete them, or pass -allowUntracked." -ForegroundColor Red
    exit 1
}
if ($untracked -and $allowUntracked) {
    Write-Host "  [2/3] Including new files (-allowUntracked):" -ForegroundColor DarkYellow
    foreach ($u in $untracked) { Write-Host "          $u" -ForegroundColor DarkYellow }
}

$status = git status --porcelain
if ($status) {
    if (-not $m) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        $m = "deploy: update & verify $timestamp"
    }
    if ($bypassed.Count -gt 0) {
        $m = "$m [gates skipped: $($bypassed -join ', ')]"
    }
    if ($dryRun) {
        Write-Host "  [2/3] DRY RUN - would commit: $m" -ForegroundColor Cyan
        Write-Host "  [2/3] DRY RUN - would stage:" -ForegroundColor Cyan
        git status --porcelain -- $stageScope
        Write-Host ""
        Write-Host "  Dry run complete. Nothing committed, nothing pushed." -ForegroundColor Cyan
        exit 0
    }
    Write-Host "  [2/3] Committing updated changes..." -ForegroundColor Yellow
    # Only the app, its docs, and the deploy tooling — never stray scratch files.
    git add -A -- $stageScope
    git commit -m $m
    Write-Host "  [2/3] OK Committed: $m" -ForegroundColor Green
} else {
    if ($dryRun) {
        Write-Host "  [2/3] DRY RUN - working tree clean, nothing to commit." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Dry run complete. Nothing committed, nothing pushed." -ForegroundColor Cyan
        exit 0
    }
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
