"use server";

import { createClient } from "@/lib/supabase/server";
import { asJsonb } from "@/lib/supabase/jsonb";
import type {
  FaceAFaceQuestion,
  FaceAFaceState,
} from "./face-a-face-state";
import {
  parseQuizzAnswers,
  requireRoomHost,
  shuffle,
} from "./tv-actions-helpers";

/**
 * P5.1 — Server actions pour le mode face-à-face. L'hôte appelle
 * `prepareFaceAFace` une fois pour charger un pool de questions et
 * démarrer la phase de vote ; les transitions ultérieures sont gérées
 * en mémoire côté client (broadcast Realtime) avec persist optionnelle.
 */

export interface PrepareFaInput {
  roomId: string;
  /** Tokens des 2 finalistes (par exemple les 2 derniers du mode regular,
   *  ou les 2 premiers à se connecter en mode face-à-face direct). */
  finalists: [string, string];
  /** Pseudos pour le state initial (cache local côté client). */
  finalistPseudos: Record<string, string>;
  /** Timer initial en secondes (default 60). */
  timerSeconds?: number;
  /** Nombre de questions à charger (default 30). */
  poolSize?: number;
}

export async function prepareFaceAFace(input: PrepareFaInput): Promise<
  | { ok: true; state: FaceAFaceState; version: number }
  | { ok: false; message: string }
> {
  const supabase = await createClient();
  const auth = await requireRoomHost(supabase, input.roomId);
  if (!auth.ok) return auth;

  const poolSize = Math.min(Math.max(input.poolSize ?? 30, 10), 60);

  // Pool de questions quizz_2 (format simple, 2 choix). On garde les choix
  // en state pour permettre au présentateur de voir la bonne réponse sur
  // son téléphone (plus tard si on veut).
  const { data: pool } = await supabase
    .from("questions")
    .select("id, enonce, reponses, format")
    .eq("type", "quizz_2")
    .limit(200);

  if (!pool || pool.length < 5) {
    return { ok: false, message: "Pas assez de questions en base." };
  }

  const questions: FaceAFaceQuestion[] = shuffle(pool)
    .slice(0, poolSize)
    .map((q) => {
      const parsed = parseQuizzAnswers(q.reponses);
      if (!parsed) return null;
      return {
        id: q.id as string,
        enonce: q.enonce as string,
        choices: parsed.choices,
        correctIdx: Math.max(0, parsed.correctIdx),
      };
    })
    .filter((q): q is FaceAFaceQuestion => q !== null);

  const timerSeconds = Math.max(20, Math.min(120, input.timerSeconds ?? 60));
  const timers: Record<string, number> = {};
  for (const t of input.finalists) timers[t] = timerSeconds;

  const state: FaceAFaceState = {
    phase: "vote",
    finalists: input.finalists,
    finalistPseudos: input.finalistPseudos,
    votes: {},
    presenterToken: null,
    challengerToken: null,
    currentChallengerToken: null,
    timers,
    questions,
    currentQuestionIdx: 0,
    ticking: false,
    winnerToken: null,
  };

  // Vague T (#1) — Le démarrage du face-à-face suit un démarrage de partie
  // (Mode 12 Coups) qui a déjà bumpé state_version. On lit la version
  // actuelle et on remet à 0 si elle vient d'un cycle précédent.
  const { data: cur } = await supabase
    .from("tv_rooms")
    .select("state_version")
    .eq("id", input.roomId)
    .maybeSingle();
  const baseVersion = cur?.state_version ?? 0;
  await supabase
    .from("tv_rooms")
    .update({
      status: "playing",
      face_a_face_state: asJsonb(state),
      state_version: baseVersion + 1,
    })
    .eq("id", input.roomId)
    .eq("host_id", auth.ctx.userId);

  return { ok: true, state, version: baseVersion + 1 };
}

/**
 * Vague T (#1) — Persiste l'état du face-à-face avec optimistic locking
 * (cf. saveDouzeCoupsState pour la logique). Retourne `{ ok: true,
 * newVersion }` ou `{ ok: false, reason }`.
 */
export type SaveFaResult =
  | { ok: true; newVersion: number }
  | { ok: false; reason: "unauthorized" | "stale" };

export async function saveFaceAFaceState(input: {
  roomId: string;
  state: FaceAFaceState;
  status?: "playing" | "ended";
  expectedVersion: number;
}): Promise<SaveFaResult> {
  const supabase = await createClient();
  const auth = await requireRoomHost(supabase, input.roomId);
  if (!auth.ok) return { ok: false, reason: "unauthorized" };

  const newVersion = input.expectedVersion + 1;
  const { count } = await supabase
    .from("tv_rooms")
    .update(
      {
        face_a_face_state: asJsonb(input.state),
        state_version: newVersion,
        ...(input.status ? { status: input.status } : {}),
        ...(input.status === "ended"
          ? { ended_at: new Date().toISOString() }
          : {}),
      },
      { count: "exact" },
    )
    .eq("id", input.roomId)
    .eq("host_id", auth.ctx.userId)
    .eq("state_version", input.expectedVersion);
  if ((count ?? 0) === 0) return { ok: false, reason: "stale" };
  return { ok: true, newVersion };
}
