# Backup and restore

**Before 2026-09-09 there was no backup of any kind.** 20 MB held every account,
every credit balance, the whole ledger and the encrypted provider keys. A lost
volume would have lost the business, not a deployment.

## Take one

```
cd personagen-svelte
npm run backup
```

Writes `backup/<timestamp>/` — one JSON file per table, `auth_users.json`,
`storage_objects.json` and `storage_buckets.json` (the media **manifest**, never
the media), and a `manifest.json` recording row counts plus the migration ledger
head at capture. It verifies itself immediately after writing.

A `.env` file is not required. Values are read from `personagen-svelte/.env` when
it exists and from the process environment otherwise, so a container, a cron job
or CI can run this with nothing on disk. An exported variable wins over the file
— the same precedence `apply-migration.mjs` uses, so the runner and the backup it
spawns can never end up pointed at two different databases.

`backup/` is gitignored. **The files hold password hashes and encrypted provider
keys.** The ciphertext only: the passphrase lives in the server environment and
never in the database, so a stolen backup alone cannot decrypt the keys. Copy a
backup somewhere off this machine; that copy is as sensitive as the database.

## Check one you already have

```
npm run backup:verify           # files match the manifest
npm run backup:check-restore    # the rows still convert into the live schema
```

`backup:verify` re-reads every file and compares it to the manifest — it catches
a dropped row, a truncated file, a deleted file.

`backup:check-restore` is the one that matters. It runs the **same**
`json_populate_recordset` conversion a restore would, as a SELECT, so Postgres
performs every cast against the live schema and throws the result away. Nothing
is written. A column that has changed type fails here instead of during an
outage, and a column the schema has since dropped is named, because that
conversion would otherwise discard it in silence.

It also states, on every run including a clean one, that the storage objects it
counted are a manifest and that the media bytes are not in the backup at all. A
green check here means *the database* restores.

Both exit non-zero on a problem, so either can be a cron check.

## Restore

```
npm run backup:sql              # writes restore.sql into the backup directory
```

Then, against the **empty** replacement database:

1. Run `supabase/client_bootstrap.sql` first. Check its migration count matches
   the header of `restore.sql` — a mismatch means you are putting data back into
   a different schema than it came from.
2. Read `restore.sql`. It is not executed for you.
3. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f restore.sql`

Every row goes back through `json_populate_recordset(null::public.<table>, …)`,
so Postgres does the type coercion. No hand-written literal has to be right about
arrays, jsonb, timestamps or enums. Foreign keys are deferred for the load with
`session_replication_role = replica`, which removes load order as a question.
`auth.users` is inserted first regardless, because everything else points at it.

## What a backup does not contain

- **Storage object CONTENT — the media itself.** This is the big one. Production
  holds hundreds of megabytes of generated images and video in the storage
  bucket, and **none of those bytes are in a backup.** What *is* captured is the
  **manifest**: `storage_objects.json` (id, bucket, name, owner, timestamps and
  `metadata` — so size, mimetype and etag) and `storage_buckets.json`, counted in
  `manifest.json` and checked by `backup:verify` like any other file. That is the
  difference between "the media is gone" and "the media is gone and we cannot
  even say what it was": with the manifest you can diff a surviving bucket volume
  and name exactly which objects are missing.

  There is deliberately **no media-download mode**. At this host's throughput a
  full copy is tens of minutes, which cannot sit inside a deploy gate. Copy the
  bucket volume separately, on its own schedule. `backup:check-restore` prints
  this limitation on every run, including successful ones, and `restore.sql`
  carries it as a comment — the manifest rows are **not** inserted, because rows
  naming files the bucket does not hold would make the app advertise media it
  cannot serve.
- **Server environment.** `SECRET_KEY_BASE` and the platform provider keys are in
  the EasyPanel environment. Without them the encrypted key columns are
  unreadable ciphertext, and users would have to re-enter their own keys.
- **GoTrue's own tables** beyond `auth.users`. Sessions and refresh tokens are not
  captured; everyone signs in again after a restore.

## Cadence

Two automatic triggers, both at the moment the risk actually appears. Neither is
a schedule — nothing runs on a clock yet.

**Every deploy.** `deploy.ps1` runs `npm run backup`, then — only if that
succeeded — `npm run backup:check-restore`, as a step-1 gate. It sits after the
test block and before anything is committed or pushed, so an abort leaves no
trace in git and nothing reaches production. A failure stops the deploy.

Pass `-skipBackup` to downgrade that failure to a warning. The bypass is appended
to the commit message (`[gates skipped: backup]`), so it is visible in `git log`
forever rather than in one terminal session. Legitimate when the database is
deliberately unreachable, or you have just taken a backup another way.

**Every migration.** `apply-migration.mjs` takes a backup immediately before the
first file of a run that is actually going to write — after the idempotence,
checksum, ledger, dry-run and provenance gates, so it never backs up for a
migration that then gets refused. One backup per run, not one per file.

Two details worth knowing:

- `--check-restore` runs **before** the migration, never after. It validates the
  dump against the *live* schema, and the migration is about to change that
  schema; run afterwards it would be testing the dump against a shape it never
  came from, and a column the migration drops would look like a backup fault.
- `000_schema_migrations.sql` is never backed up. On a fresh database
  `public.schema_migrations` does not exist yet and the backup reads it for the
  ledger head, so it would die on the one migration that has nothing to lose. The
  next real file in the same run still gets its backup.

`--no-backup` skips it, loudly, in the same spirit as `--allow-uncommitted`.
`--dry-run` and the read-only commands (`--status`, `--unrecord`, `--rehash
--dry-run`) never take one.

Still worth doing by hand before any EasyPanel change that touches the database
service. A weekly cron calling `npm run backup && npm run backup:check-restore`
remains the next improvement — both exit non-zero on a problem, so either can be
a cron check on its own.
