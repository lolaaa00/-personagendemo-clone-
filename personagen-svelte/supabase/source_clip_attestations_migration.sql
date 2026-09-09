-- ═══════════════════════════════════════════════════════════════════════════
-- Source-clip attestations — who asserted they may use an uploaded clip.
--
-- Video-to-video re-performs footage the account did not shoot. The upload
-- endpoint refuses without an explicit affirmative from the uploader, and this
-- table is where that affirmative is KEPT. One row per accepted clip.
--
-- WHY IT IS NOT THE ACTIVITY LOG
--
-- The first implementation recorded this through `user_activity_events`. That
-- store is gated by the ACTIVITY_LOG switch, which is off by default, and every
-- emitter is a no-op while it is off — so the route would take the attestation,
-- drop it, and store the clip anyway. An audit trail that exists only as a
-- checkbox nobody can produce later is worse than none, because it reads like
-- evidence. This table has no switch.
--
-- The two stores also answer different questions and age differently. Activity
-- events are pseudonymous telemetry, partitioned by month and PRUNED
-- (prune_activity_partitions). A rights assertion is the opposite: few rows,
-- kept indefinitely, and worthless if it cannot be tied to a person.
--
-- Append-only by design. No UPDATE or DELETE policy exists for anyone but the
-- service role: a claim you can quietly revise after a dispute is not a record.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_clip_attestations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- No FK, and nullable, for the same reason the activity log has none: the
  -- record must outlive the account. A deleted user does not un-assert what
  -- they asserted, and cascading this away would delete the evidence exactly
  -- when it is most likely to be wanted.
  user_id       UUID,
  workspace_id  UUID,
  agent_id      UUID,
  -- The storage PATH, not a signed or public URL: URLs expire and rotate, the
  -- path is what still identifies the object years later.
  clip_path     TEXT NOT NULL,
  mime          TEXT,
  bytes         BIGINT,
  -- Measured by ffprobe at ingest, not declared by the client. This is also the
  -- per-second billing basis, so it is worth having a second durable copy of it
  -- outside the generation ledger.
  duration_sec  NUMERIC(10, 3),
  -- Which wording the user agreed to. Versioned so a later change to the
  -- statement cannot retroactively alter what a past user is recorded as having
  -- agreed to — the single most important column here after user_id.
  statement     TEXT NOT NULL DEFAULT 'source-clip-rights-v1',
  -- Constrained to TRUE: a row may only exist for an affirmative assertion, so
  -- "no row" and "declined" can never be confused, and a bug that wrote `false`
  -- fails loudly instead of recording a consent that was never given.
  attested      BOOLEAN NOT NULL DEFAULT TRUE CHECK (attested),
  request_id    TEXT
);

COMMENT ON TABLE public.source_clip_attestations IS
  'Append-only record of a user asserting they may use an uploaded source clip. Written by the service role at ingest; never updated or deleted.';

-- Ingest refuses a clip it cannot record, so the write is on the hot path: keep
-- the lookup it does (and the admin "show me this clip's provenance" query)
-- indexed rather than sequential.
CREATE INDEX IF NOT EXISTS idx_source_clip_attest_user_created
  ON public.source_clip_attestations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_clip_attest_clip_path
  ON public.source_clip_attestations (clip_path);

ALTER TABLE public.source_clip_attestations ENABLE ROW LEVEL SECURITY;

-- A user may READ their own assertions — they are entitled to see what they
-- agreed to. Nobody but the service role may write, and no policy grants UPDATE
-- or DELETE to anyone, which is what makes the table append-only in practice
-- and not merely by convention.
DROP POLICY IF EXISTS "own attestations are readable" ON public.source_clip_attestations;
CREATE POLICY "own attestations are readable"
  ON public.source_clip_attestations
  FOR SELECT
  USING (auth.uid() = user_id);
