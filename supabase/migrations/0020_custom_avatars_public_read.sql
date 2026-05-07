-- =============================================================================
-- Vague U (#4) — Lecture publique des avatars custom (table custom_avatars)
-- =============================================================================
-- Avant : la policy RLS sur `custom_avatars` exigeait `TO authenticated`,
-- donc les guests non auth (joueurs sur /play/[code] qui rejoignent par
-- code) ne pouvaient PAS voir les avatars custom uploadés par l'admin.
-- Côté code, on cachait l'onglet via `hideCustomTab` dans AvatarPicker.
--
-- Maintenant : on autorise les guests à LIRE les URLs (pas d'INSERT/UPDATE).
-- Les URLs ne sont pas sensibles — c'est juste des liens vers le bucket
-- Storage. La policy d'écriture (admin only) reste inchangée.
-- =============================================================================

CREATE POLICY "custom_avatars select public"
  ON public.custom_avatars FOR SELECT
  TO anon
  USING (true);
