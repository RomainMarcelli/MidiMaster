"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { spreadByCategoryWithGetter } from "@/lib/game-logic/spread-by-category";
import type { Json, QuestionType } from "@/types/database";
import type { RevQuestion } from "@/lib/revision/types";

const REVISION_MASTERY_THRESHOLD = 3;

// ===========================================================================
// Anciens : marquer un résultat sur une question déjà dans wrong_answers
// ===========================================================================

/**
 * Enregistre le résultat d'une question en révision.
 *  - Correcte : incrémente success_streak. À THRESHOLD, supprime la ligne.
 *  - Fausse : reset success_streak à 0, +1 fail_count, last_seen_at refresh.
 *
 * Si la question n'est PAS dans wrong_answers et que le résultat est faux,
 * on l'ajoute (ce qui permet aux modes "Apprendre / Flashcards / Marathon" de
 * remonter une question dans À retravailler dès qu'on la rate).
 */
export async function markRevisionResult(
  questionId: string,
  isCorrect: boolean,
): Promise<
  | { status: "mastered" | "kept" | "added" }
  | { status: "error"; message: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing, error: selErr } = await supabase
    .from("wrong_answers")
    .select("id, fail_count, success_streak")
    .eq("user_id", user.id)
    .eq("question_id", questionId)
    .maybeSingle();

  if (selErr) {
    return { status: "error", message: selErr.message };
  }

  if (!existing) {
    if (isCorrect) {
      // Pas de ligne → on n'a rien à faire pour une bonne réponse.
      return { status: "mastered" };
    }
    // Première erreur trackée pour cette question : on l'ajoute.
    const { error } = await supabase.from("wrong_answers").insert({
      user_id: user.id,
      question_id: questionId,
      fail_count: 1,
      success_streak: 0,
    });
    if (error) return { status: "error", message: error.message };
    // I1.2 — Refresh immédiat du compteur "X erreurs à revoir" sur le
    // hub révision. Sans ça, l'utilisateur quittant Marathon devait
    // recharger la page pour voir ses nouvelles erreurs apparaître.
    revalidatePath("/revision");
    return { status: "added" };
  }

  if (isCorrect) {
    const newStreak = existing.success_streak + 1;
    if (newStreak >= REVISION_MASTERY_THRESHOLD) {
      const { error } = await supabase
        .from("wrong_answers")
        .delete()
        .eq("id", existing.id);
      if (error) return { status: "error", message: error.message };
      revalidatePath("/revision");
      return { status: "mastered" };
    }
    const { error } = await supabase
      .from("wrong_answers")
      .update({
        success_streak: newStreak,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return { status: "error", message: error.message };
    return { status: "kept" };
  }

  const { error } = await supabase
    .from("wrong_answers")
    .update({
      fail_count: existing.fail_count + 1,
      success_streak: 0,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) return { status: "error", message: error.message };
  // I1.2 — Refresh même sur update (ex. fail_count incrémenté
  // → la liste des erreurs s'est rafraîchie pour cette question).
  revalidatePath("/revision");
  return { status: "kept" };
}

/**
 * G1.2 — Marque une question comme révisée (mode lecture seule).
 *
 * Supprime directement la ligne dans `wrong_answers` sans la requalifier.
 * Différent de `markRevisionResult(true)` qui exige
 * REVISION_MASTERY_THRESHOLD bonnes réponses successives.
 *
 * Use case : depuis l'écran "Voir mes erreurs", l'utilisateur lit la
 * bonne réponse et décide qu'il l'a comprise sans rejouer la question.
 */
export async function markErrorAsReviewed(
  questionId: string,
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("wrong_answers")
    .delete()
    .eq("user_id", user.id)
    .eq("question_id", questionId);

  if (error) return { status: "error", message: error.message };
  // H1.4 — Refresh le compteur "X erreurs à revoir" du hub révision.
  revalidatePath("/revision");
  return { status: "ok" };
}

/**
 * I1.3 — Batch markErrorAsReviewed : supprime plusieurs lignes
 * `wrong_answers` en un seul appel. Utilisé en fin de quizz "Refaire
 * mes erreurs" pour flusher toutes les questions correctement
 * répondues qui n'ont pas encore été supprimées.
 */
export async function markErrorsAsReviewed(
  questionIds: string[],
): Promise<{ status: "ok"; deleted: number } | { status: "error"; message: string }> {
  if (questionIds.length === 0) return { status: "ok", deleted: 0 };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count, error } = await supabase
    .from("wrong_answers")
    .delete({ count: "exact" })
    .eq("user_id", user.id)
    .in("question_id", questionIds);

  if (error) return { status: "error", message: error.message };
  revalidatePath("/revision");
  return { status: "ok", deleted: count ?? 0 };
}

/**
 * H1.5 — Vide complètement la liste `wrong_answers` de l'utilisateur
 * connecté. Action irréversible (à protéger par une modal de
 * confirmation côté UI).
 */
export async function resetAllWrongAnswers(): Promise<
  { status: "ok"; deleted: number } | { status: "error"; message: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count, error } = await supabase
    .from("wrong_answers")
    .delete({ count: "exact" })
    .eq("user_id", user.id);

  if (error) return { status: "error", message: error.message };
  revalidatePath("/revision");
  return { status: "ok", deleted: count ?? 0 };
}

// ===========================================================================
// Tirage de questions selon filtres (pour Apprendre / Marathon)
// ===========================================================================

interface FetchInput {
  categoryIds: number[];
  difficulties: number[];
  types: QuestionType[];
  count: number;
  /**
   * J1.5 — IDs de questions à exclure du tirage (mémoire courte
   * terme côté client : les questions des N dernières sessions
   * Marathon, persistées en localStorage, ne sont pas retirées
   * pendant un moment).
   *
   * Si après exclusion le pool est plus petit que `count`, on
   * complète avec des exclues pour garantir que l'utilisateur a
   * toujours `count` questions à jouer (mieux qu'une session vide).
   */
  excludeQuestionIds?: string[];
}

export async function fetchQuestionsForRevision(
  input: FetchInput,
): Promise<{ status: "ok"; questions: RevQuestion[] } | { status: "error"; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Migration 0023 — Tirage aléatoire fait côté Postgres via la RPC
  // `random_questions` (ORDER BY random() sur le pool filtré complet).
  // Avant : `.limit(oversample)` sans ORDER BY renvoyait toujours les N
  // mêmes premières lignes (ordre physique), puis on shufflait côté JS.
  // Avec 250 IDs récents exclus, il restait toujours ~le même petit pool
  // → impression que "ce sont toujours les mêmes questions".
  //
  // `Database.Functions` est vide (RPC pas dans les types générés) → on
  // cast le client pour appeler la fonction Postgres manuellement.
  const rpcPromise = (
    supabase as unknown as {
      rpc: (
        name: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: RawQuestion[] | null; error: { message: string } | null }>;
    }
  ).rpc("random_questions", {
    p_category_ids: input.categoryIds.length > 0 ? input.categoryIds : null,
    p_difficulties: input.difficulties.length > 0 ? input.difficulties : null,
    p_types: input.types.length > 0 ? input.types : null,
    p_count: Math.max(1, input.count),
    p_exclude_ids:
      input.excludeQuestionIds && input.excludeQuestionIds.length > 0
        ? input.excludeQuestionIds
        : null,
  });

  const [{ data: rpcRows, error }, { data: cats }] = await Promise.all([
    rpcPromise,
    supabase.from("categories").select("id, nom, couleur"),
  ]);
  if (error) return { status: "error", message: error.message };

  const catsById = new Map((cats ?? []).map((c) => [c.id, c] as const));
  const all = (rpcRows ?? []).map((q) => normalizeQuestion(q, catsById));
  // F1.3 — Anti-répétition de catégories (3 questions d'écart minimum).
  // Skip auto si pool < 2 catégories distinctes (cas du mode mono-cat).
  const spread = spreadByCategoryWithGetter(
    all,
    (q) => q.category?.id ?? null,
    3,
  );
  return { status: "ok", questions: spread };
}

// ===========================================================================
// Défi du jour : 5 questions déterministes par date
// ===========================================================================

export async function fetchDailyChallenge(): Promise<
  | { status: "ok"; questions: RevQuestion[]; date: string }
  | { status: "error"; message: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const [{ data: qs, error }, { data: cats }] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id, type, category_id, difficulte, enonce, reponses, bonne_reponse, alias, explication",
      )
      .in("type", ["quizz_2", "quizz_4"])
      .limit(500),
    supabase.from("categories").select("id, nom, couleur"),
  ]);
  if (error) return { status: "error", message: error.message };

  const catsById = new Map((cats ?? []).map((c) => [c.id, c] as const));
  const all = (qs ?? []).map((q) => normalizeQuestion(q, catsById));

  // Seed déterministe par date pour que tous voient les mêmes questions.
  const seed = hashSeed(date);
  const shuffled = shuffleArray(all, seed).slice(0, 5);
  // F1.3 — Anti-répétition (5 questions, donc l'algo va surtout
  // essayer de varier sans contrainte forte).
  const spread = spreadByCategoryWithGetter(
    shuffled,
    (q) => q.category?.id ?? null,
    3,
  );
  return { status: "ok", questions: spread, date };
}

// ===========================================================================
// Mode Fiche : liste questions par catégorie (pas de quiz, lecture)
// ===========================================================================

export async function fetchFiche(
  categoryId: number,
  limit = 30,
): Promise<
  | { status: "ok"; questions: RevQuestion[] }
  | { status: "error"; message: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: qs, error }, { data: cats }] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id, type, category_id, difficulte, enonce, reponses, bonne_reponse, alias, explication",
      )
      .eq("category_id", categoryId)
      .limit(limit),
    supabase.from("categories").select("id, nom, couleur"),
  ]);
  if (error) return { status: "error", message: error.message };

  const catsById = new Map((cats ?? []).map((c) => [c.id, c] as const));
  const all = (qs ?? []).map((q) => normalizeQuestion(q, catsById));
  return { status: "ok", questions: all };
}

// ===========================================================================
// Helpers
// ===========================================================================

interface RawQuestion {
  id: string;
  type: QuestionType;
  category_id: number | null;
  difficulte: number;
  enonce: string;
  reponses: Json;
  bonne_reponse: string | null;
  alias: Json | null;
  explication: string | null;
}

function normalizeQuestion(
  q: RawQuestion,
  catsById: Map<number, { id: number; nom: string; couleur: string | null }>,
): RevQuestion {
  const cat = q.category_id != null ? catsById.get(q.category_id) ?? null : null;
  return {
    questionId: q.id,
    type: q.type,
    enonce: q.enonce,
    reponses: Array.isArray(q.reponses)
      ? (q.reponses as { text: string; correct: boolean }[])
      : [],
    bonneReponse: q.bonne_reponse ?? "",
    alias: Array.isArray(q.alias) ? (q.alias as string[]) : [],
    explication: q.explication,
    category: cat,
    difficulte: q.difficulte,
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleArray<T>(arr: T[], seed?: number): T[] {
  const out = [...arr];
  let s = seed ?? Math.floor(Math.random() * 1e9);
  function rand() {
    // Mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
