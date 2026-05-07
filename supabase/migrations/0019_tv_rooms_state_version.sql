-- =============================================================================
-- Vague T (#1) — Optimistic concurrency control sur tv_rooms.state
-- =============================================================================
-- Avant : `saveDouzeCoupsState` réécrivait tout le JSONB `state` à chaque tour
-- sans vérification, ce qui ouvrait la porte à des saves concurrents (un bot
-- et un humain qui répondent simultanément) qui s'écrasaient silencieusement.
--
-- Ajoute une colonne `state_version` (compteur monotone) qui sert de garde-fou
-- optimiste : chaque UPDATE doit fournir la version courante en filtre, et
-- incrémenter de 1. Si l'UPDATE retourne 0 lignes → conflit → on log côté
-- serveur et on retourne `{ ok: false, reason: "stale" }` au caller.
--
-- La colonne est partagée par tous les saves de la room (state, face_a_face_state,
-- status) — c'est UNE version globale par room, pas une par champ.
-- =============================================================================

ALTER TABLE public.tv_rooms
  ADD COLUMN IF NOT EXISTS state_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tv_rooms.state_version IS
  'Vague T — Compteur monotone incrémenté à chaque UPDATE concurrent du state. Sert de optimistic lock dans saveDouzeCoupsState/saveFaceAFaceState.';
