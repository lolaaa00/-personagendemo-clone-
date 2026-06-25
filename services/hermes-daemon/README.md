# Hermes Daemon — DEPRECATED

> **This service has been removed.** The Gemini polling daemon (`worker.js`) was a
> placeholder that polled Supabase for unclaimed messages and responded via
> Gemini 3.5 Flash. It has been replaced by the real NousResearch Hermes Agent
> running as a Docker container with its built-in gateway API.

## Current Architecture

The real Hermes agent is defined in the root `docker-compose.yml`:

```yaml
hermes:
  image: nousresearch/hermes-agent:latest
  command: hermes gateway run --mcp-server http://mcp-bridge:8000/sse?token=$MCP_BRIDGE_TOKEN
```

SvelteKit calls the Hermes gateway directly at `http://hermes:8642/v1/chat/completions`
(OpenAI-compatible API). Hermes uses the MCP bridge for database access.

## Safe to Delete

This entire directory (`services/hermes-daemon/`) can be safely deleted.
No other service or docker-compose target references it.
