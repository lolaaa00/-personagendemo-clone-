-- ═══════════════════════════════════════════════════════════════════════════
-- Platform settings — operator switches that live in the database so a
-- platform admin flips them from the Admin Console, with no env change and no
-- redeploy. Env vars of the same name still WIN when set (emergency override
-- from the host), which keeps "turn everything off with two env vars" true.
--
--   credits_mode      "off" | "shadow" | "enforce"
--   activity_log      true | false
--   activity_pepper   secret used to hash IPs / subjects in the activity log —
--                     generated here on first apply, never shown in the UI,
--                     rotatable from the console (accepting a one-day
--                     correlation gap by design)
--
-- Service-role only. Reads go through the app's cached loader (settings.ts);
-- writes through /api/admin/settings, each one an audited activity event.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM anon, authenticated;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('credits_mode',    '"off"'::jsonb,  'off = no wallet reads/writes · shadow = debit, never block · enforce = fail-closed'),
  ('activity_log',    'false'::jsonb,  'Record pseudonymous user activity (page views, actions, executions)'),
  ('activity_pepper', to_jsonb(encode(gen_random_bytes(32), 'hex')), 'Hashing secret for IP/subject hashes — rotate to break cross-period correlation')
ON CONFLICT (key) DO NOTHING;

-- Audit trail of every change (the activity log records it too; this survives retention).
CREATE TABLE IF NOT EXISTS public.platform_settings_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  changed_by  UUID,
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings_history FROM anon, authenticated;

-- Single mutator: validates, records history, returns the new value.
CREATE OR REPLACE FUNCTION public.platform_setting_set(p_key TEXT, p_value JSONB, p_actor UUID DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old JSONB;
BEGIN
  IF p_key = 'credits_mode' AND NOT (p_value #>> '{}' IN ('off', 'shadow', 'enforce')) THEN
    RAISE EXCEPTION 'credits_mode must be off | shadow | enforce' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'activity_log' AND jsonb_typeof(p_value) <> 'boolean' THEN
    RAISE EXCEPTION 'activity_log must be a boolean' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'activity_pepper' AND length(p_value #>> '{}') < 32 THEN
    RAISE EXCEPTION 'activity_pepper must be at least 32 characters' USING ERRCODE = '22023';
  END IF;
  SELECT value INTO v_old FROM public.platform_settings WHERE key = p_key;
  INSERT INTO public.platform_settings (key, value, updated_by) VALUES (p_key, p_value, p_actor)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
  INSERT INTO public.platform_settings_history (key, old_value, new_value, changed_by, note)
    VALUES (p_key, v_old, p_value, p_actor, p_note);
  RETURN p_value;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_setting_set(TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
