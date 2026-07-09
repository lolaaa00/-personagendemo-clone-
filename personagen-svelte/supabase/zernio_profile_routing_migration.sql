-- Per-persona Zernio routing: consolidation onto Zernio as the single provider.
--
-- Architecture (decided 2026-07-08): ONE Zernio account (one API key, user-scoped)
-- with ONE Zernio *profile* per persona. Zernio profiles are the native per-brand
-- bucket — each persona's connected social accounts live under its own profileId,
-- so multi-persona routing is clean without stacking separate keys/emails.
-- Billing is pay-per-connected-account (2 free, then $6/mo each), metered globally
-- across the key — not a per-persona tier.
--
-- Safe/idempotent. Read defensively: code treats a null zernio_profile_id as
-- "provision on first connect", so this migration only unlocks the routing.

ALTER TABLE public.agents
	ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT;

COMMENT ON COLUMN public.agents.zernio_profile_id IS
	'Zernio profile _id that isolates this persona''s connected social accounts under the single shared Zernio key. Provisioned on first connect (list-or-create by persona name).';

-- NOTE ON connections.provider: we intentionally do NOT tighten the existing
-- CHECK constraint. Legacy rows may still carry provider='composio'|'blotato';
-- narrowing the constraint while those rows exist would fail. All NEW writes use
-- provider='zernio' (Composio/Blotato client code is removed), and the publisher
-- only routes Zernio, so stale-provider rows simply need a reconnect — they can't
-- misroute. Leaving the constraint permissive keeps this migration non-destructive.
