import type { LifeState } from "@/components/game/LifeBar";
import type { Database, QuestionFormat } from "@/types/database";

/**
 * Logique métier du Coup d'Envoi (ex Quizz 1/2, multijoueur).
 *
 * Règles :
 *  - 2+ candidats, tour par tour. Chacun reçoit une question quizz_2.
 *  - Chaque question peut avoir un `format` : vrai_faux, ou, plus_moins.
 *  - Chaque joueur a **2 vies** : 0 erreur = vert, 1 erreur = orange, 2 erreurs = rouge.
 *  - La manche continue jusqu'à ce qu'un joueur passe au rouge → Duel.
 *  - Timer par question : 10 s.
 *
 *  Scoring (par manche terminée sans passer au rouge) :
 *    - +50 XP par bonne réponse donnée par le user
 *    - bonus XP selon l'issue du Duel (voir duel.ts)
 */

export const CE_TIMER_SECONDS = 10;
export const CE_MAX_ERRORS = 2;
export const CE_XP_PER_CORRECT = 50;

type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];
type CategoryRow = Pick<
  Database["public"]["Tables"]["categories"]["Row"],
  "id" | "nom" | "couleur"
>;

export interface CeQuestion {
  id: string;
  format: QuestionFormat | null;
  enonce: string;
  reponses: { text: string; correct: boolean }[];
  category?: { nom: string; couleur: string | null };
  explication: string | null;
  difficulte: number;
}

/**
 * Prépare une question pour l'UI : les réponses sont gardées dans l'ordre
 * pour les formats vrai_faux et plus_moins (Vrai toujours à gauche, Plus
 * toujours à gauche), mélangées seulement en format "ou".
 */
export function prepareCeQuestion(
  q: QuestionRow,
  categoriesById: Map<number, CategoryRow>,
  rng: () => number = Math.random,
): CeQuestion {
  const rawReponses = Array.isArray(q.reponses)
    ? (q.reponses as unknown as { text: string; correct: boolean }[])
    : [];

  const format: QuestionFormat | null =
    q.format === "vrai_faux" ||
    q.format === "ou" ||
    q.format === "plus_moins" ||
    q.format === "choix_2"
      ? q.format
      : null;

  let reponses = rawReponses.slice(0, 2);

  // Randomise la position des 2 réponses pour tous les formats (Vrai/Faux,
  // Plus/Moins, L'un ou l'autre) — demande user : éviter que la bonne soit
  // toujours à la même position.
  if (reponses.length === 2 && rng() < 0.5) {
    reponses = [reponses[1]!, reponses[0]!];
  }

  const cat = q.category_id ? categoriesById.get(q.category_id) : null;

  return {
    id: q.id,
    format,
    enonce: q.enonce,
    reponses,
    category: cat ? { nom: cat.nom, couleur: cat.couleur } : undefined,
    explication: q.explication,
    difficulte: q.difficulte,
  };
}

/**
 * Sélectionne un pool de questions quizz_2 mélangé (ordre aléatoire), pour
 * éviter de rejouer les mêmes questions sur une partie.
 * Le client tire ensuite séquentiellement dedans.
 */
export function shuffleCePool(
  pool: QuestionRow[],
  rng: () => number = Math.random,
): QuestionRow[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** 0 erreur → green, 1 → yellow, 2+ → red. */
export function ceLifeState(errors: number): LifeState {
  if (errors <= 0) return "green";
  if (errors === 1) return "yellow";
  return "red";
}

/** Un joueur est-il « hors jeu » (au rouge) ? */
export function ceIsPlayerOut(errors: number): boolean {
  return errors >= CE_MAX_ERRORS;
}

/**
 * Pour le format "vrai_faux", l'énoncé peut être préfixé par "Vrai ou faux :".
 * On nettoie pour un affichage propre (on affiche le préfixe dans l'UI).
 */
export function stripFormatPrefix(enonce: string): string {
  return enonce
    .replace(/^vrai ou faux\s*[:?]?\s*/i, "")
    .replace(/^l['`’]un ou l['`’]autre\s*[:?]?\s*/i, "")
    .replace(/^plus ou moins\s*[:?]?\s*/i, "")
    .trim();
}

/** Libellé humain du format. */
export function formatLabel(format: QuestionFormat | null): string {
  switch (format) {
    case "vrai_faux":
      return "Vrai ou faux ?";
    case "ou":
      return "L'un ou l'autre ?";
    case "plus_moins":
      return "Plus ou moins ?";
    case "choix_2":
      return "";
    default:
      return "";
  }
}

/** Calcul d'XP pour le user : +50 XP par bonne réponse donnée. */
export function computeCeXp(userCorrectCount: number): number {
  return userCorrectCount * CE_XP_PER_CORRECT;
}

export interface CeAnswerLog {
  questionId: string;
  isCorrect: boolean;
  timeMs: number;
  /** id du joueur qui a répondu. */
  playerId: string;
  /** true si c'est le user authentifié (pour les stats BDD). */
  byUser: boolean;
}
