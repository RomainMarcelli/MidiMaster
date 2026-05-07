"use server";

import { createClient } from "@/lib/supabase/server";
import { asJsonb } from "@/lib/supabase/jsonb";
import { requireRoomHost } from "./tv-actions-helpers";
import {
  applyConvertToBot,
  applyEliminateLeftPlayer,
} from "@/app/(app)/tv/host/[code]/tv-douze-coups-machine-helpers";
import {
  isTvDouzeCoupsState,
  type TvDouzeCoupsState,
} from "./tv-douze-coups-state";

/**
 * Vague V (#7) — Server actions pour gerer l'abandon d'un joueur en
 * cours de partie.
 *
 * Toutes ces actions :
 *  - Verifient que l'appelant est bien l'hote de la room (`requireRoomHost`).
 *  - Chargent le state JSONB courant + state_version (optimistic locking).
 *  - Appliquent un helper pure (`applyEliminateLeftPlayer` / `applyConvertToBot`).
 *  - Sauvent le nouveau state via UPDATE filtre sur la version attendue.
 *
 * En cas de stale write (un autre save concurrent a deja bumpe la version),
 * on retourne `{ ok: false, reason: "stale" }` et le caller (modal hote)
 * affiche un message de retry. Tres improbable en pratique : seul l'host
 * appelle ces actions et il n'y a pas de concurrence avec lui-meme.
 */

interface AbandonInput {
  roomId: string;
  playerToken: string;
  /** Version attendue en BDD (= dernier `newVersion` connu cote client). */
  expectedVersion: number;
}

export type AbandonResult =
  | { ok: true; newVersion: number }
  | { ok: false; reason: "unauthorized" | "stale" | "no-state" | "no-player" };

/**
 * Charge le state, applique un helper transform, sauve avec optimistic
 * locking. Helper interne reutilise par les 2 actions ci-dessous.
 */
async function applyAndSave(
  input: AbandonInput,
  transform: (s: TvDouzeCoupsState) => TvDouzeCoupsState | null,
): Promise<AbandonResult> {
  const supabase = await createClient();
  const auth = await requireRoomHost(supabase, input.roomId);
  if (!auth.ok) return { ok: false, reason: "unauthorized" };

  const { data: room } = await supabase
    .from("tv_rooms")
    .select("state, state_version")
    .eq("id", input.roomId)
    .maybeSingle();
  if (!room || !isTvDouzeCoupsState(room.state)) {
    return { ok: false, reason: "no-state" };
  }
  const currentState = room.state as TvDouzeCoupsState;
  const nextState = transform(currentState);
  if (!nextState) return { ok: false, reason: "no-player" };

  const newVersion = input.expectedVersion + 1;
  const { count } = await supabase
    .from("tv_rooms")
    .update(
      {
        state: asJsonb(nextState),
        state_version: newVersion,
      },
      { count: "exact" },
    )
    .eq("id", input.roomId)
    .eq("host_id", auth.ctx.userId)
    .eq("state_version", input.expectedVersion);
  if ((count ?? 0) === 0) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, newVersion };
}

/**
 * "Continuer" : elimine le joueur qui a quitte. Si c'etait son tour →
 * advance turn. Si on franchit le seuil de phase (CE→CPC ≤3, CPC→FA ≤2)
 * → transition automatique. Reset la pause.
 */
export async function eliminatePlayerForLeaving(
  input: AbandonInput,
): Promise<AbandonResult> {
  return applyAndSave(input, (s) => applyEliminateLeftPlayer(s, input.playerToken));
}

/**
 * "Remplacer par bot" : le joueur garde son token / pseudo / avatar mais
 * devient un bot avec le `botSkill` fourni. Reset la pause + met aussi
 * a jour `tv_room_players.is_bot = true` pour la coherence (la liste de
 * joueurs cote lobby utilise cette colonne).
 */
export async function replaceLeftPlayerWithBot(
  input: AbandonInput & { botSkill?: number },
): Promise<AbandonResult> {
  const skill = Math.max(0, Math.min(100, input.botSkill ?? 70));
  const result = await applyAndSave(input, (s) =>
    applyConvertToBot(s, input.playerToken, skill),
  );
  if (!result.ok) return result;
  // Coherence cote table tv_room_players (sinon le lobby continuerait
  // d'afficher "humain"). Best-effort : si ca echoue, le state JSONB
  // est deja a jour donc l'orchestrateur fait jouer le bot quand meme.
  const supabase = await createClient();
  await supabase
    .from("tv_room_players")
    .update({ is_bot: true, bot_skill: skill })
    .eq("room_id", input.roomId)
    .eq("player_token", input.playerToken);
  return result;
}
