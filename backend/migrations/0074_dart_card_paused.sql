-- Suspend the feature without deleting issued cards or draw history.
UPDATE site_settings
   SET data=jsonb_set(
       jsonb_set(COALESCE(data,'{}'::jsonb),'{dartCardEnabled}','false'::jsonb,true),
       '{dartCardPausedAt}',to_jsonb(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
       version=version+1,updated_at=now()
 WHERE id='main' AND NOT (COALESCE(data,'{}'::jsonb) ? 'dartCardEnabled');
