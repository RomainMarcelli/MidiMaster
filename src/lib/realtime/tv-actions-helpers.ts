/**
 * Vague T (#2) — Helpers partagés entre les server actions TV
 * (`tv-douze-coups-actions.ts`, `face-a-face-actions.ts`, etc.).
 *
 * Centralise :
 *  - Le boilerplate auth + room.host_id (`requireRoomHost`).
 *  - Le parsing des `reponses` BDD vers `{ choices, correctIdx }`
 *    (`parseQuizzAnswers`) — utilisé par tous les parsers de question
 *    type quizz_2 / quizz_4 / face_a_face.
 *  - Le shuffle Fisher-Yates uniforme (`shuffle`) — remplace les
 *    `arr.sort(() => Math.random() - 0.5)` biaisés qu'on avait éparpillés.
 *
 * Tous ces helpers sont des fonctions PURES et testables (pas de Supabase
 * client requis sauf `requireRoomHost` qui prend le supabase en arg).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Auth + room ownership
// ============================================================================

export interface RoomHostContext {
  userId: string;
}

export type RoomHostResult =
  | { ok: true; ctx: RoomHostContext }
  | { ok: false; message: string };

/**
 * Vérifie en un seul aller-retour qu'un user est connecté ET qu'il est
 * bien l'hôte de la room demandée. Retourne `{ ok: true, ctx }` ou un
 * message d'erreur safe-to-display côté client.
 *
 * On NE renvoie PAS l'objet user complet — juste `userId` qui est tout ce
 * dont les actions ont besoin pour les checks `eq("host_id", userId)`
 * ultérieurs sur les UPDATE.
 */
export async function requireRoomHost(
  supabase: SupabaseClient,
  roomId: string,
): Promise<RoomHostResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Non authentifié." };

  const { data: room } = await supabase
    .from("tv_rooms")
    .select("id, host_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.host_id !== user.id) {
    return { ok: false, message: "Room introuvable ou non autorisée." };
  }

  return { ok: true, ctx: { userId: user.id } };
}

// ============================================================================
// Parsing BDD → types métier
// ============================================================================

interface RawAnswer {
  text: string;
  correct?: boolean;
}

export interface ParsedQuizzAnswers {
  choices: Array<{ idx: number; text: string }>;
  /** Index de la bonne réponse, ou -1 si aucune n'est marquée correct. */
  correctIdx: number;
}

/**
 * Parse une cellule `reponses` (JSONB) vers la forme utilisée par les
 * questions quizz_2 / quizz_4 / face_a_face. Tolère un payload null ou
 * mal formé en retournant `null` (le caller filtre).
 */
export function parseQuizzAnswers(
  reponses: unknown,
): ParsedQuizzAnswers | null {
  const arr = (reponses as RawAnswer[] | null | undefined) ?? [];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const choices = arr.map((r, idx) => ({ idx, text: r.text }));
  const correctIdx = arr.findIndex((r) => r.correct === true);
  return { choices, correctIdx };
}

// ============================================================================
// Shuffle uniforme (Fisher-Yates)
// ============================================================================

/**
 * Mélange un array uniformément (Fisher-Yates). Remplace les
 * `[...arr].sort(() => Math.random() - 0.5)` biaisés qu'on trouvait
 * encore dans face-a-face-actions.ts.
 *
 * `rng` injectable pour les tests (default `Math.random`).
 */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
