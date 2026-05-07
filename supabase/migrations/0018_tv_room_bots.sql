-- =============================================================================
-- Vague S3 — Bots IA pour compléter les parties à 4 joueurs
-- =============================================================================
-- Permet à l'hôte d'ajouter des "bots" comme joueurs supplémentaires quand
-- moins de 4 humains sont connectés. Les bots :
--   - sont des lignes tv_room_players normales (token, pseudo, avatar_url)
--   - ont is_bot = true (flag visuel + logique)
--   - ont bot_skill (0..100) qui contrôle leur taux de réussite
--
-- Convention : leur player_token est préfixé "bot:" (généré côté serveur
-- par addBotToRoom). Pas de clé Supabase auth pour eux — ce sont des
-- avatars 100% côté serveur/TV, leurs réponses sont simulées par
-- l'orchestrateur TV via setTimeout + Math.random < bot_skill/100.
-- =============================================================================

ALTER TABLE public.tv_room_players
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tv_room_players
  ADD COLUMN IF NOT EXISTS bot_skill INTEGER NOT NULL DEFAULT 70
    CHECK (bot_skill >= 0 AND bot_skill <= 100);

COMMENT ON COLUMN public.tv_room_players.is_bot IS
  'True si ce joueur est un bot IA (Vague S3). Ses réponses sont simulées côté TV.';

COMMENT ON COLUMN public.tv_room_players.bot_skill IS
  'Taux de réussite cible des bots, en pourcentage (0..100). Default 70.';

-- Index partiel utile pour filtrer rapidement les bots (rare mais peu coûteux).
CREATE INDEX IF NOT EXISTS tv_room_players_bots_idx
  ON public.tv_room_players (room_id) WHERE is_bot = TRUE;
