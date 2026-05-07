"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseQuizzAnswers } from "@/lib/realtime/tv-actions-helpers";

/**
 * Vague V (#2) — Question d'entrainement infini cote telephone.
 *
 * Sert le quiz affiche aux joueurs pendant l'attente (entre "rejoint la
 * room" et "premiere question reelle"). Pas d'impact sur le score de la
 * partie ; pas d'anti-cheat (le `correct: true` est volontairement
 * envoye au telephone pour reveler la bonne reponse en local).
 *
 * On ne tire que des `quizz_2` et `quizz_4` (pas de `coup_par_coup` qui
 * a une mecanique speciale a 7 propositions).
 *
 * Vague X (#9) — Utilise le client admin (service_role) pour bypasser
 * la RLS `questions_select_auth`. Les joueurs guests qui rejoignent une
 * room TV ne sont PAS authentifies (pas de cookie supabase) -> sans
 * service_role, count() renvoie 0 (RLS masque tout) et la function
 * throw "No training questions available in BDD". Lecture seule,
 * pas de risque securite.
 */
export interface TrainingQuestion {
  id: string;
  enonce: string;
  type: "quizz_2" | "quizz_4";
  /** Choix avec marqueur `correct: true` sur la bonne reponse. */
  choices: Array<{ idx: number; text: string; correct: boolean }>;
  explication: string | null;
}

const ALLOWED_TYPES = ["quizz_2", "quizz_4"] as const;

/**
 * Retourne une question quizz random (offset aleatoire). Utilise un
 * `count` puis un `range(offset, offset)` pour eviter de tout charger en
 * memoire (la table `questions` peut avoir plusieurs milliers d'entrees).
 *
 * Throws si la BDD ne renvoie rien ou si la question ne parse pas. Le
 * caller (cf. `<TrainingQuizz />`) attrape et retry apres 2s.
 */
export async function getRandomTrainingQuestion(): Promise<TrainingQuestion> {
  const supabase = createAdminClient();

  const { count, error: countError } = await supabase
    .from("questions")
    .select("*", { count: "exact", head: true })
    .in("type", ALLOWED_TYPES);
  if (countError) {
    // eslint-disable-next-line no-console
    console.error("[X9:training] count error", countError);
    throw new Error(`Failed to count training questions: ${countError.message}`);
  }
  const total = count ?? 0;
  // eslint-disable-next-line no-console
  console.log("[X9:training] count result", { total });
  if (total === 0) {
    throw new Error("No training questions available in BDD");
  }

  const offset = Math.floor(Math.random() * total);
  const { data, error } = await supabase
    .from("questions")
    .select("id, enonce, type, reponses, explication")
    .in("type", ALLOWED_TYPES)
    .range(offset, offset)
    .single();
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error("[X9:training] fetch error", { offset, error });
    throw new Error(
      `Failed to fetch training question at offset ${offset}: ${error?.message}`,
    );
  }

  // Reutilise le parser quizz partage (Vague T helper) qui gere les
  // formats BDD attendus + la deduplication d'index.
  const parsed = parseQuizzAnswers(data.reponses);
  if (!parsed) {
    throw new Error(`Malformed training question ${data.id}`);
  }
  const correctIdx = Math.max(0, parsed.correctIdx);
  return {
    id: data.id as string,
    enonce: data.enonce as string,
    type: data.type as "quizz_2" | "quizz_4",
    choices: parsed.choices.map((c) => ({
      idx: c.idx,
      text: c.text,
      correct: c.idx === correctIdx,
    })),
    explication: (data.explication as string | null) ?? null,
  };
}
