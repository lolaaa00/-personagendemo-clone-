# Hermes Daemon

Long-running runtime for the PersonaGen Hermes overseer agent.

## Required Environment

- `SUPABASE_URL` or `PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`

## Run

```bash
npm install
npm start
```

The daemon polls for unclaimed user messages addressed to agents with `is_overseer = true` and `runtime_owner = 'hermes-daemon'`, claims each message, builds session context, generates a response, and writes the model turn to the same `session_id`.
