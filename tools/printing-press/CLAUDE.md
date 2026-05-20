# CLAUDE.md (Local Printing Press CLIs)

## Overview
This directory contains Go-based CLI tools designed to interface directly with external APIs (Stripe, ClickUp, etc.) from the local machine, providing token-lean Markdown outputs back to the agent.

## Commands
- **Sync Environment Variables**: `node scripts/sync-secrets.js`
- **Build ClickUp CLI**: `go build -o bin/pp-clickup.exe src/clickup/main.go`
- **Build Stripe CLI**: `go build -o bin/pp-stripe.exe src/stripe/main.go`
- **Clean Binaries**: `rm -Force bin/*`

## Code Standards
- **Language**: Go (v1.22+)
- **Output format**: Use formatted Markdown tables for listings to save input tokens.
- **Error handling**: Exit with non-zero code on failure. Redirect log and debug output to `stderr` so only pure results hit `stdout`.
- **Secrets**: Read secrets strictly from environment variables. Do not hardcode API keys.
- **Rules Enforcement**: Consult `cli-rules.json` before executing or drafting new command interfaces.
