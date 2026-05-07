"use server";

import { createClient } from "@/lib/supabase/server";
import { asJsonb } from "@/lib/supabase/jsonb";
import {
  buildFinalRanking,
  pickDuelThemes,
  type CpcQuestion,
  type DcPlayer,
  type DuelTheme,
  type QuizzQuestion,
  type TvDouzeCoupsState,
} from "./tv-douze-coups-state";
import {
  parseQuizzAnswers,
  requireRoomHost,
  shuffle,
} from "./tv-actions-helpers";

/**
 * Vague R — Server actions pour le mode 12 Coups TV.
 *
 * Le client TV (hôte) appelle ces actions pour démarrer la partie, charger
 * les questions, et persister le state à chaque transition. La synchro live
 * passe par Realtime broadcast (cf. tv-channel.ts).
 */

interface PrepareInput {
  roomId: string;
  /** Tokens des joueurs dans l'ordre de tour. */
  turnOrder: string[];
  /** Pseudos + avatars + flag bot associés (cache local). */
  playersMeta: Array<{
    token: string;
    pseudo: string;
    avatarUrl: string | null;
    /** Vague S3 — true si bot IA. */
    isBot?: boolean;
    /** Vague S3 — taux de réussite du bot (0..100). Default 70. */
    botSkill?: number;
  }>;
  /** Mode de désignation du présentateur ("random" | "vote"). */
  presenterDesignationMode?: "random" | "vote";
}

const POOL_COUP_ENVOI = 50;
const POOL_COUP_PAR_COUP = 30;
const POOL_DUELS = 30;

/**
 * Charge les pools de questions pour les 3 phases et initialise le state
 * en mode "coup-envoi-playing". À appeler depuis l'hôte au démarrage.
 */
export async function startDouzeCoupsTv(
  input: PrepareInput,
): Promise<
  | { ok: true; state: TvDouzeCoupsState; version: number }
  | { ok: false; message: string }
> {
  const supabase = await createClient();
  const auth = await requireRoomHost(supabase, input.roomId);
  if (!auth.ok) return auth;

  if (input.turnOrder.length < 2) {
    return { ok: false, message: "Au moins 2 joueurs requis." };
  }

  // Vague T — Étape 1 utilise quizz_2 (boutons A/B), duels en quizz_4
  // pour la difficulté supplémentaire requise pour départager. Charge
  // les 3 pools en parallèle.
  const [quizz2Result, quizz4Result, cpcResult] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id, enonce, reponses, format, explication, category_id",
      )
      .eq("type", "quizz_2")
      .limit(200),
    supabase
      .from("questions")
      .select(
        "id, enonce, reponses, format, explication, category_id",
      )
      .eq("type", "quizz_4")
      .limit(200),
    supabase
      .from("questions")
      .select("id, enonce, reponses, explication")
      .eq("type", "coup_par_coup")
      .limit(150),
  ]);

  if (quizz2Result.error || !quizz2Result.data) {
    return {
      ok: false,
      message: `Pas de questions quizz_2 (${quizz2Result.error?.message})`,
    };
  }
  if (quizz4Result.error || !quizz4Result.data) {
    return {
      ok: false,
      message: `Pas de questions quizz_4 (${quizz4Result.error?.message})`,
    };
  }
  if (cpcResult.error || !cpcResult.data) {
    return {
      ok: false,
      message: `Pas de questions coup_par_coup (${cpcResult.error?.message})`,
    };
  }
  if (quizz2Result.data.length < POOL_COUP_ENVOI / 2) {
    return {
      ok: false,
      message: `Trop peu de questions quizz_2 (${quizz2Result.data.length}, requis ≥ ${POOL_COUP_ENVOI / 2}).`,
    };
  }
  if (quizz4Result.data.length < POOL_DUELS / 2) {
    return {
      ok: false,
      message: `Trop peu de questions quizz_4 pour les duels (${quizz4Result.data.length}, requis ≥ ${POOL_DUELS / 2}).`,
    };
  }
  if (cpcResult.data.length < 5) {
    return {
      ok: false,
      message: `Trop peu de questions coup_par_coup (${cpcResult.data.length}).`,
    };
  }

  // Convertit + mélange. Le parser quizz est commun (le format des
  // entrées BDD est identique : reponses[] avec un correct=true), seul
  // le nombre de choices diffère (2 vs 4).
  const allQuizz2 = quizz2Result.data
    .map(parseQuizz)
    .filter((q): q is QuizzQuestion => q !== null);
  const allQuizz4 = quizz4Result.data
    .map(parseQuizz)
    .filter((q): q is QuizzQuestion => q !== null);
  const allCpc = cpcResult.data
    .map(parseCpc)
    .filter((q): q is CpcQuestion => q !== null);

  const coupEnvoiPool = shuffle(allQuizz2).slice(0, POOL_COUP_ENVOI);
  const duelsPool = shuffle(allQuizz4).slice(0, POOL_DUELS);
  const cpcPool = shuffle(allCpc).slice(0, POOL_COUP_PAR_COUP);

  // Construit les players
  const metaByToken = new Map(
    input.playersMeta.map((m) => [m.token, m]),
  );
  const players: DcPlayer[] = input.turnOrder.map((token) => {
    const meta = metaByToken.get(token);
    return {
      token,
      pseudo: meta?.pseudo ?? "?",
      avatarUrl: meta?.avatarUrl ?? null,
      lifeStatus: "green",
      isEliminated: false,
      eliminatedAt: null,
      eliminatedInPhase: null,
      score: 0,
      isFinalist: false,
      isBot: meta?.isBot ?? token.startsWith("bot:"),
      botSkill: meta?.botSkill ?? 70,
    };
  });

  const state: TvDouzeCoupsState = {
    phase: "coup-envoi-playing",
    players,
    turnOrder: input.turnOrder,
    currentPlayerIdx: 0,
    currentQuestion: coupEnvoiPool[0] ?? null,
    currentDuel: null,
    eliminationAnimation: null,
    questionPool: {
      coupEnvoi: coupEnvoiPool.slice(1), // 0 est déjà current
      coupParCoup: cpcPool,
      duels: duelsPool,
    },
    faceAFacePresenterToken: null,
    presenterDesignationMode: input.presenterDesignationMode ?? "random",
    finalRanking: null,
    lastAnswerKey: null,
    cpcFoundIndices: [],
    duelMemory: null,
    pausedReason: null,
    pausedPlayerToken: null,
    pausedPlayerPseudo: null,
  };

  // Vague T (#1) — On reset state_version à 0 au démarrage. Les saves
  // ultérieurs utilisent un optimistic lock sur cette colonne.
  await supabase
    .from("tv_rooms")
    .update({
      status: "playing",
      state: asJsonb(state),
      state_version: 0,
    })
    .eq("id", input.roomId)
    .eq("host_id", auth.ctx.userId);

  return { ok: true, state, version: 0 };
}

/**
 * Vague T (#1) — Résultat d'un save avec optimistic concurrency.
 * `stale` = un autre save concurrent a déjà bumpé state_version → on
 * laisse le caller décider (ignore / refetch / retry).
 */
export type SaveStateResult =
  | { ok: true; newVersion: number }
  | { ok: false; reason: "unauthorized" | "stale" };

/**
 * Persiste le state du jeu (best-effort, pour reconnexion / résumé). Appelée
 * à chaque transition de phase ou changement de turn.
 *
 * Vague T (#1) — Optimistic locking via `expectedVersion` :
 *  - le UPDATE filtre sur `state_version = expectedVersion`
 *  - le UPDATE assigne `state_version = expectedVersion + 1`
 *  - si l'UPDATE renvoie `count: 0` → un autre save a passé entre-temps,
 *    on retourne `stale` (le caller décide quoi faire).
 */
export async function saveDouzeCoupsState(input: {
  roomId: string;
  state: TvDouzeCoupsState;
  status?: "playing" | "paused" | "ended";
  /** Version attendue en BDD (= dernier `newVersion` retourné). */
  expectedVersion: number;
}): Promise<SaveStateResult> {
  const supabase = await createClient();
  const auth = await requireRoomHost(supabase, input.roomId);
  if (!auth.ok) return { ok: false, reason: "unauthorized" };

  const newVersion = input.expectedVersion + 1;
  const { count } = await supabase
    .from("tv_rooms")
    .update(
      {
        state: asJsonb(input.state),
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
  if ((count ?? 0) === 0) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, newVersion };
}

/**
 * Charge les catégories disponibles pour les duels par thème (= celles qui
 * ont au moins 1 question quizz_4). Retourne un set de DuelTheme.
 */
export async function loadDuelThemeCandidates(
  roomCode: string,
): Promise<DuelTheme[]> {
  const supabase = await createClient();
  // Charge les catégories puis croise avec les counts quizz_4.
  const [{ data: cats }, { data: q4 }] = await Promise.all([
    supabase.from("categories").select("id, slug, nom"),
    supabase.from("questions").select("category_id").eq("type", "quizz_4"),
  ]);
  if (!cats || !q4) return [];

  const countByCat = new Map<number, number>();
  for (const row of q4) {
    if (row.category_id == null) continue;
    countByCat.set(
      row.category_id,
      (countByCat.get(row.category_id) ?? 0) + 1,
    );
  }
  // Garde juste les catégories avec ≥ 1 question quizz_4
  void roomCode; // not used yet, kept for future filtering
  return cats
    .filter((c) => (countByCat.get(c.id) ?? 0) >= 1)
    .map((c) => ({ id: c.id, slug: c.slug, nom: c.nom }));
}

/**
 * Tire 2 thèmes aléatoires pour un duel. Server action (utilise un random
 * côté serveur pour éviter les manipulations client).
 */
export async function pickDuelThemesAction(
  roomCode: string,
): Promise<DuelTheme[]> {
  const candidates = await loadDuelThemeCandidates(roomCode);
  return pickDuelThemes(candidates);
}

/**
 * Charge UNE question quizz_4 d'une catégorie donnée (pour un duel).
 * Si plusieurs questions, on en tire une au hasard.
 */
export async function pickDuelQuestion(
  themeId: number,
): Promise<QuizzQuestion | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("questions")
    .select("id, enonce, reponses, format, explication, category_id")
    .eq("type", "quizz_4")
    .eq("category_id", themeId)
    .limit(50);
  if (!data || data.length === 0) return null;
  const pick = data[Math.floor(Math.random() * data.length)]!;
  return parseQuizz(pick);
}

/**
 * Construit le classement final et persiste. Appelé en fin de face-à-face.
 */
export async function finalizeDouzeCoupsTv(input: {
  roomId: string;
  state: TvDouzeCoupsState;
  winnerToken: string | null;
  expectedVersion: number;
}): Promise<SaveStateResult> {
  const finalRanking = buildFinalRanking(input.state.players, input.winnerToken);
  const next: TvDouzeCoupsState = {
    ...input.state,
    phase: "podium",
    finalRanking,
  };
  return saveDouzeCoupsState({
    roomId: input.roomId,
    state: next,
    status: "playing", // on reste en playing, l'hôte ferme via Quitter ou Recommencer
    expectedVersion: input.expectedVersion,
  });
}

/**
 * R3 — Reset la room en lobby tout en gardant les joueurs actuels.
 * Réutilisé par le bouton "Recommencer" du podium.
 */
export async function restartRoom(
  roomId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createClient();
  const auth = await requireRoomHost(supabase, roomId);
  if (!auth.ok) return auth;

  // Vague T (#1) — Reset state_version aussi : on repart à 0 pour le
  // prochain démarrage de partie.
  const { error } = await supabase
    .from("tv_rooms")
    .update({
      status: "waiting",
      state: asJsonb({}),
      face_a_face_state: null,
      state_version: 0,
    })
    .eq("id", roomId)
    .eq("host_id", auth.ctx.userId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ============================================================================
// Parsers locaux (utilisent les helpers partagés tv-actions-helpers.ts)
// ============================================================================

function parseQuizz(row: {
  id: string;
  enonce: string;
  reponses: unknown;
  format?: string | null;
  explication?: string | null;
  category_id?: number | null;
}): QuizzQuestion | null {
  const parsed = parseQuizzAnswers(row.reponses);
  if (!parsed) return null;
  return {
    id: row.id,
    enonce: row.enonce,
    format: row.format ?? null,
    choices: parsed.choices,
    correctIdx: Math.max(0, parsed.correctIdx),
    explication: row.explication ?? null,
    categoryId: row.category_id ?? null,
  };
}

interface RawReponse {
  text: string;
  correct?: boolean;
}

function parseCpc(row: {
  id: string;
  enonce: string;
  reponses: unknown;
  explication?: string | null;
}): CpcQuestion | null {
  const reponses = (row.reponses as RawReponse[]) ?? [];
  if (!Array.isArray(reponses) || reponses.length < 2) return null;
  // Format coup_par_coup : 7 propositions, dont 1 avec correct=false (l'intrus).
  const propositions = reponses.map((r, idx) => ({
    idx,
    text: r.text,
    correct: r.correct === true,
  }));
  const intrusIdx = propositions.findIndex((p) => !p.correct);
  if (intrusIdx === -1) return null;
  return {
    id: row.id,
    enonce: row.enonce,
    propositions,
    intrusIdx,
    explication: row.explication ?? null,
  };
}

// `shuffle` est désormais importé depuis `./tv-actions-helpers`.
