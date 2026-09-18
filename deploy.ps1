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
    # Production had no backup of any kind until 2026-09-09. Every deploy now takes
    # one and proves it still restores, before anything is committed or pushed.
    # Passing this downgrades a failed backup to a warning and records "backup" in
    # the commit message. Legitimate only when the database is deliberately
    # unreachable, or you have just taken a backup by other means.
    [switch]$allowBackupFailure = $false,
    # Run every gate and print what WOULD be staged, then stop. Commits nothing,
    # pushes nothing. This is how you test a change to this script.
    [switch]$dryRun = $false
)

# Gates that were bypassed, appended to the commit message so the bypass is
# visible in `git log` forever instead of only in one terminal session.
$bypassed = @()

# ── Guard: this script deploys main, so it must be RUN from main ─────────
# Step 2 commits the working tree onto whatever branch is checked out, and
# Step 3 pushes `main` regardless. Run from a feature branch, the gates pass,
# the commit lands on the feature branch, an unchanged main is pushed, and
# Easypanel rebuilds nothing — while the operator believes they deployed.
# Measured 2026-09-17 on ux/portal-overhaul, 26 commits ahead of main.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
    Write-Host "  [0/3] ERROR: deploy.ps1 pushes main, but this tree is on '$branch'." -ForegroundColor Red
    Write-Host "  [0/3]        Merge or fast-forward main first, check it out, then deploy." -ForegroundColor Red
    exit 1
}

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

# Provider truth: what our catalogs CLAIM must match what the providers actually
# serve. Two checks ride this one run:
#   - registry truth   — the Model Manager's rows vs the resolvers and live catalog
#   - voices truth     — every voice in the picker must actually render audio
# The *_STRICT flags turn "I could not reach the provider" into a failure —
# without them the suite skips and exits 0, letting this gate pass having checked
# nothing. That is exactly how 8 dead voices sat in the picker unnoticed: a
# catalog nobody compares to the provider drifts silently and for free.
Write-Host "  [0/3] Checking model registry + voice catalog truth against the live providers..." -ForegroundColor Yellow
$env:REGISTRY_TRUTH_STRICT = "1"
$env:VOICES_TRUTH_STRICT = "1"
$registryExit = Invoke-Gate "npx vitest run --project integration"
Remove-Item Env:\REGISTRY_TRUTH_STRICT -ErrorAction SilentlyContinue
Remove-Item Env:\VOICES_TRUTH_STRICT -ErrorAction SilentlyContinue
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
# Run it WITHOUT --warn-only. Under that flag the probe exits 0 whatever it
# finds, so the abort below could never fire: this gate reported OK no matter
# what production was doing. That is the defect this repo has a name for.
#
# It still does not block, because both doors are open today and holding every
# deploy hostage to an environment change is not this script's call. What it
# does now is tell the truth and RECORD it — an open gate lands in $bypassed and
# therefore in the commit message, so every commit shipped while registration
# was open says so in git log, permanently.
#
# Once GOTRUE_DISABLE_SIGNUP=true and ADMIN_PIN are both set, turn the
# `$bypassed +=` branch into an abort and this becomes a hard gate.
$authExit = Invoke-Gate "node scripts/preflight-auth.mjs"
if ($authExit -ne 0) {
    Write-Host "  [1/3] WARNING: registration is OPEN - see docs/runbooks/signup-and-admission.md." -ForegroundColor Red
    Write-Host "  [1/3]          Shipping anyway, and recording it in the commit message." -ForegroundColor Red
    $bypassed += "open-registration"
} else {
    Write-Host "  [1/3] OK: the signup gate is closed on both doors." -ForegroundColor Green
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

# ── Pre-deploy backup ──
# Production had no backup of any kind until 2026-09-09. This is the last moment a
# deploy is still free: nothing has been committed and nothing has been pushed, so
# aborting here leaves no trace. The working directory is still personagen-svelte,
# which npm run requires - there is no package.json at the repo root - and
# $bypassed is still writable, so a bypass reaches the commit message and stays in
# `git log` forever.
#
# Two separate calls, so the output says WHICH half failed.
Write-Host "  [1/3] Taking a database backup..." -ForegroundColor Yellow
$backupExit = Invoke-Gate "npm run backup"
if ($backupExit -eq 0) {
    # A failing check-restore is not noise. It is the specific signal that a column
    # has changed type or been dropped and the backup on disk will NOT load - which
    # is precisely the moment not to ship.
    Write-Host "  [1/3] Proving the backup still restores..." -ForegroundColor Yellow
    $backupExit = Invoke-Gate "npm run backup:check-restore"
}
if ($backupExit -ne 0) {
    if ($allowBackupFailure) {
        Write-Host "  [1/3] WARNING: BACKUP GATE BYPASSED (-allowBackupFailure) - shipping with no proven restore point." -ForegroundColor Red
        $bypassed += "backup"
    } else {
        Write-Host "  [1/3] ERROR: the backup failed, or it will not restore into the live schema." -ForegroundColor Red
        Write-Host "  [1/3]        Read the output above: a 'will NOT load', or a named dropped" -ForegroundColor Red
        Write-Host "  [1/3]        column, means a restore would lose data. Fix it, or pass -allowBackupFailure." -ForegroundColor Red
        Set-Location $projectDir
        exit 1
    }
} else {
    Write-Host "  [1/3] OK: backup taken and proven to restore." -ForegroundColor Green
    Write-Host "  [1/3]     Database only - the media bytes in storage are never captured." -ForegroundColor DarkGray
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
    # Say exactly which tracked files are about to be committed. `git add -A` on
    # the scope takes every modification in it, including ones made by another
    # session sharing this tree — on 2026-09-17 that was 24 files that were not
    # the deployer's. A list the operator has to scroll past is the cheapest
    # guard against shipping someone else's half-finished work.
    $swept = git status --porcelain -- $stageScope | Where-Object { $_ -notmatch '^\?\?' }
    if ($swept) {
        Write-Host "  [2/3] Committing $(@($swept).Count) modified tracked file(s) in scope:" -ForegroundColor DarkYellow
        foreach ($w in $swept) { Write-Host "          $w" -ForegroundColor DarkYellow }
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

# ── Step 3: Push to GitHub, then trigger the Easypanel deploy, then prove it ──
# personagen-app has autoDeploy OFF (measured via projects.listProjectsAndServices on
# 2026-09-18): a push to origin/main rebuilds NOTHING by itself. This step used to end
# with "Easypanel is rebuilding" — a belief, not a mechanism; the fingerprint on
# production stayed put for six minutes after a real push. It now calls the
# service's deploy webhook and watches the build fingerprint change. Without a
# token it says so and fails, instead of reporting a deploy that never happened.
$fingerprintUrl = "https://honeyx.monarchstack.com/_app/version.json"
$baselineVersion = ""
try { $baselineVersion = (Invoke-RestMethod -Uri $fingerprintUrl -TimeoutSec 15).version } catch {}

Write-Host "  [3/3] Pushing to GitHub (origin/main)..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [3/3] ERROR: Push failed" -ForegroundColor Red
    exit 1
}
Write-Host "  [3/3] OK Pushed to origin/main" -ForegroundColor Green

# The deploy token lives in the app's gitignored .env (EASYPANEL_DEPLOY_TOKEN), or
# in the environment. Its ONLY source is the Easypanel UI: l2g -> personagen-app ->
# Deploy -> "Webhook URL", whose last path segment is the token. The ops gateway
# masks every token it returns (each one reads "[redacted]"), so nothing fetched
# through it can be used here - on 2026-09-18 that placeholder was stored by
# mistake and the webhook answered 404. It is never committed.
$deployToken = $env:EASYPANEL_DEPLOY_TOKEN
if (-not $deployToken) {
    $envFile = Join-Path $projectDir "personagen-svelte\.env"
    $envLine = Get-Content $envFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^EASYPANEL_DEPLOY_TOKEN=' } | Select-Object -First 1
    if ($envLine) { $deployToken = ($envLine -split '=', 2)[1].Trim() }
}
if ($deployToken -and $deployToken -notmatch '^[A-Za-z0-9_-]{8,}$') {
    Write-Host "  [3/3] NOT DEPLOYED: EASYPANEL_DEPLOY_TOKEN is a placeholder ('$deployToken'), not a token." -ForegroundColor Red
    Write-Host "  [3/3]     Copy the real one from Easypanel: l2g -> personagen-app -> Deploy -> Webhook URL (last path segment)." -ForegroundColor Red
    exit 1
}
if (-not $deployToken) {
    Write-Host "  [3/3] NOT DEPLOYED: personagen-app has autoDeploy OFF and no EASYPANEL_DEPLOY_TOKEN is set." -ForegroundColor Red
    Write-Host "  [3/3]     Copy it from Easypanel (l2g -> personagen-app -> Deploy -> Webhook URL) into personagen-svelte/.env, or click Deploy there." -ForegroundColor Red
    exit 1
}

Write-Host "  [3/3] Triggering the Easypanel deploy..." -ForegroundColor Yellow
try {
    $resp = Invoke-RestMethod -Method Post -Uri "https://zi1cc5.easypanel.host/api/deploy/$deployToken" -ContentType "application/json" -Body "{}" -TimeoutSec 30
    Write-Host "  [3/3] OK Deploy accepted: $resp" -ForegroundColor Green
} catch {
    Write-Host "  [3/3] ERROR: deploy webhook failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Message -match '404') {
        Write-Host "  [3/3]     404 means the token is not this service's deploy token. The push succeeded; production is NOT rebuilt." -ForegroundColor Red
        Write-Host "  [3/3]     Copy the token from Easypanel (l2g -> personagen-app -> Deploy -> Webhook URL) or click Deploy there." -ForegroundColor Red
    }
    exit 1
}

# Proof, not a promise: SvelteKit stamps every build with a new version, so the
# fingerprint changes exactly when the new container starts serving.
Write-Host "  [3/3] Waiting for production to serve the new build (fingerprint was '$baselineVersion')..." -ForegroundColor Yellow
$deadline = (Get-Date).AddMinutes(12)
$live = $baselineVersion
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    try { $live = (Invoke-RestMethod -Uri $fingerprintUrl -TimeoutSec 15).version } catch {}
    if ($live -and $live -ne $baselineVersion) { break }
}
if ($live -and $live -ne $baselineVersion) {
    Write-Host "  [3/3] OK Production is serving the new build (fingerprint $live)." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Pipeline complete! Pushed and deployed." -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "  [3/3] WARNING: pushed and the deploy was accepted, but the fingerprint has not changed after 12 minutes (still '$live'). Check the Easypanel build log." -ForegroundColor Red
    exit 1
}
