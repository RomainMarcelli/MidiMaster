"use server";

import { createClient } from "@/lib/supabase/server";
import type { TvGameState, TvQuestionData } from "./tv-game-state";

/**
 * Server actions de l'hôte : charge un set de questions pour démarrer une
 * partie TV, persiste l'état complet dans `tv_rooms.state`.
 *
 * On ne renvoie au client hôte que l'état nécessaire (incluant la bonne
 * réponse — l'hôte est de confiance, c'est lui qui valide). Les téléphones
 * reçoivent un payload "scrubbed" via le channel Realtime (cf. tv-channel).
 */

interface PrepareInput {
  roomId: string;
  /** Liste des player_tokens dans l'ordre de tour souhaité. */
  turnOrder: string[];
  /** Nombre de questions à charger (par défaut 10). */
  totalRounds?: number;
}

export async function prepareTvGame(input: PrepareInput): Promise<{
  ok: true;
  state: TvGameState;
} | { ok: false; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Non authentifié." };

  // Vérifie que c'est bien la room du host
  const { data: room } = await supabase
    .from("tv_rooms")
    .select("id, host_id")
    .eq("id", input.roomId)
    .maybeSingle();
  if (!room || room.host_id !== user.id) {
    return { ok: false, message: "Room introuvable ou non autorisée." };
  }

  const totalRounds = Math.min(Math.max(input.totalRounds ?? 10, 4), 30);

  // Charge `totalRounds` questions quizz_2 random (le mode TV simplifié
  // ne joue qu'avec ce format pour l'instant — boutons A/B uniformes).
  const { data: pool } = await supabase
    .from("questions")
    .select("id, enonce, reponses, bonne_reponse, alias, format, explication")
    .eq("type", "quizz_2")
    .limit(200);

  if (!pool || pool.length < totalRounds) {
    return {
      ok: false,
      message: "Pas assez de questions quizz_2 en base.",
    };
  }

  // Mélange + sélection
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, totalRounds);
  const questions: TvQuestionData[] = shuffled.map((q) => {
    const reponses = (q.reponses as unknown as Array<{
      text: string;
      correct?: boolean;
    }>) ?? [];
    const choices = reponses.map((r, idx) => ({ idx, text: r.text }));
    const correctIdx = reponses.findIndex((r) => r.correct === true);
    return {
      id: q.id as string,
      enonce: q.enonce as string,
      format: (q.format as string | null) ?? null,
      choices,
      correctIdx: Math.max(0, correctIdx),
      explication: (q.explication as string | null) ?? null,
    };
  });

  const scores: Record<string, number> = {};
  for (const t of input.turnOrder) scores[t] = 0;

  const state: TvGameState = {
    phase: "playing",
    questions,
    currentQuestionIdx: 0,
    currentPlayerToken: input.turnOrder[0] ?? null,
    scores,
    turnOrder: input.turnOrder,
    totalRounds,
    currentRound: 0,
  };

  await supabase
    .from("tv_rooms")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "playing", state: state as any })
    .eq("id", input.roomId)
    .eq("host_id", user.id);

  return { ok: true, state };
}

/**
 * Persiste l'état du jeu (transition entre questions / fin). Appelé
 * périodiquement par l'hôte pour permettre la reconnexion.
 */
export async function saveTvGameState(input: {
  roomId: string;
  state: TvGameState;
  status?: "playing" | "paused" | "ended";
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("tv_rooms")
    .update({
      // TvGameState est sérialisable JSONB. Cast any local au champ
      // uniquement (le reste de l'objet reste typé strictement).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state: input.state as any,
      ...(input.status ? { status: input.status } : {}),
      ...(input.status === "ended"
        ? { ended_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", input.roomId)
    .eq("host_id", user.id);
}
