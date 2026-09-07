-- ARCHIVED 2026-09-05. One-off account email rename, applied once in June 2026.
-- NOT a migration: it is excluded from build-bootstrap.mjs and apply_all_pending.sql
-- and must never be run against another project. Kept for the audit trail only.

BEGIN;
UPDATE auth.users 
SET email = 'monarchstackteam@gmail.com' 
WHERE email = 'client@personagen.ai';

UPDATE auth.identities 
SET identity_data = jsonb_set(identity_data, '{email}', '"monarchstackteam@gmail.com"')
WHERE email = 'client@personagen.ai';
COMMIT;
