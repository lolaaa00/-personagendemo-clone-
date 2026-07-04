# Blotato deterministic publishing rig

Turns interactive (MCP) Blotato use into a strict courier: the model publishes
**exactly** the approved payload or the call is blocked by the harness.

## Pieces

1. **`../hooks/validate-blotato-publish.mjs`** — PreToolUse gate. Blocks any
   Blotato publish call whose `accountId` isn't allowlisted, whose media isn't
   https, or (strict mode) whose payload doesn't byte-match an approved draft.
2. **`../blotato-allowlist.json`** — the policy file (create from the template
   below after running the account sync; IDs come from
   `GET /v2/users/me/accounts` or the PersonaGen connections table).
3. **`../workflows/blotato-publish-queue.js`** — deterministic Workflow script:
   coded loop over approved posts; agents only execute one exact payload each,
   schema-validated; results verified and reported.

## settings.json wiring (merge into .claude/settings.json)

```json
{
  "permissions": {
    "allow": [
      "mcp__blotato__*list*",
      "mcp__blotato__*get*"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__blotato__.*",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/validate-blotato-publish.mjs" }
        ]
      }
    ]
  }
}
```

Exact tool names (from help.blotato.com/api/mcp/examples):
- Read-only (allow): `blotato_list_accounts`, `blotato_list_posts`,
  `blotato_list_schedules`, `blotato_list_visual_templates`,
  `blotato_get_visual_status`
- Publish/mutate (gated by the hook): `blotato_create_post`,
  `blotato_update_schedule`, `blotato_delete_schedule`
- Spend (AI credits — gate or allow deliberately): `blotato_create_visual`,
  `blotato_create_source`, `blotato_create_presigned_upload_url`

The hook's publish-pattern (`/publish|create.*post|schedule/i`) already
matches `blotato_create_post` and the schedule mutators. Connector setup:
claude.ai → Settings → Connectors → add `https://mcp.blotato.com/mcp`
(OAuth while logged into Blotato).

## blotato-allowlist.json template

```json
{
  "strict": true,
  "accountIds": ["<blotato-account-id-ig>", "<blotato-account-id-tiktok>"],
  "approvedPayloads": [
    {
      "text": "exact approved caption…",
      "mediaUrls": ["https://…/approved.mp4"]
    }
  ]
}
```

`strict: false` relaxes to accountId+https+non-empty checks only (useful for
the first trial-week smoke test; flip to true for production courier runs).

## Run

```
/loop or direct: Workflow({ scriptPath: ".claude/workflows/blotato-publish-queue.js",
  args: { posts: [{ postId, accountId, platform, text, mediaUrls: [...] }] } })
```

The args ARE the determinism: the script never invents payloads — it ferries
what PersonaGen's review queue approved.
