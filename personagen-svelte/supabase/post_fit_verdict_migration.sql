-- ═══════════════════════════════════════════════════════════════════════════
-- Persona Model v2 P3.3 — a post gets somewhere to keep the fit judge's verdict.
--
-- The judge reads a finished draft as four concrete viewers from the persona's
-- own panel and reports, per viewer, the one thing that would stop them and how
-- likely they are to take it seriously. Until now there was nowhere to put that:
-- the verdict lived for the length of one request and was thrown away.
--
-- Two columns, both NULLABLE and both ADVISORY:
--   · fit_score  — the mean across the viewers that returned a usable score.
--   · fit_notes  — the per-viewer entries ({viewerIndex, fit, objection, viewer}),
--                  carried as written so a card can render without re-sampling
--                  the panel.
--
-- NULL is a first-class, expected state and must stay one: the switch is off,
-- the persona has never stated an audience, the wallet refused, the model
-- answered nonsense — every one of those resolves to "no verdict", never to a
-- post that failed to be created. A quality opinion that can take down
-- publishing is worse than no opinion at all, so nothing here is NOT NULL and
-- nothing here has a default.
--
-- Additive and idempotent: re-running changes nothing, and existing rows keep
-- the NULL that already describes them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.posts
	ADD COLUMN IF NOT EXISTS fit_score INT,
	ADD COLUMN IF NOT EXISTS fit_notes JSONB;

COMMENT ON COLUMN public.posts.fit_score IS
	'Advisory viewer-panel fit, 0-100 (mean of the scored viewers). NULL = no verdict: judge off, no stated audience, refused, or unparseable. Never blocks a post.';

COMMENT ON COLUMN public.posts.fit_notes IS
	'Advisory per-viewer entries from the fit judge: [{viewerIndex, fit, objection?, viewer?}]. NULL whenever fit_score is NULL.';
