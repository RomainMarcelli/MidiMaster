-- =============================================================================
-- Vague R — Mode TV Douze Coups complet (3 étapes + duels)
-- =============================================================================
-- Étend le check de tv_rooms.status pour accepter 'closed' (Q3.1) et garde
-- compat avec les statuts existants. Le nouveau state machine multi-phases
-- (coup-envoi → coup-par-coup → face-a-face → podium) est stocké entièrement
-- dans tv_rooms.state (JSONB existant), pas besoin d'une colonne dédiée.
-- =============================================================================

ALTER TABLE public.tv_rooms
DROP CONSTRAINT IF EXISTS tv_rooms_status_check;

ALTER TABLE public.tv_rooms
ADD CONSTRAINT tv_rooms_status_check
CHECK (status IN (
  'waiting',
  'playing',
  'paused',
  'ended',
  'closed'
));

comment on column public.tv_rooms.state is
  'État sérialisé du mode 12 Coups TV (TvDouzeCoupsState côté TS) ou état du mode legacy quizz_2 (TvGameState). Voir src/lib/realtime/tv-douze-coups-state.ts.';
