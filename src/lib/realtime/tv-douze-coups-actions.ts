"use server";

import { createClient } from "@/lib/supabase/server";
import {
  buildFinalRanking,
  pickDuelThemes,
  type CpcQuestion,
  type DcPlayer,
  type DuelTheme,
  type QuizzQuestion,
  type TvDouzeCoupsState,
} from "./tv-douze-coups-state";

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
  | { ok: true; state: TvDouzeCoupsState }
  | { ok: false; message: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Non authentifié." };

  const { data: room } = await supabase
    .from("tv_rooms")
    .select("id, host_id")
    .eq("id", input.roomId)
    .maybeSingle();
  if (!room || room.host_id !== user.id) {
    return { ok: false, message: "Room introuvable ou non autorisée." };
  }

  if (input.turnOrder.length < 2) {
    return { ok: false, message: "Au moins 2 joueurs requis." };
  }

  // Charge les 3 pools en parallèle
  const [quizz4Result, cpcResult] = await Promise.all([
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
  if (quizz4Result.data.length < POOL_COUP_ENVOI / 2) {
    return {
      ok: false,
      message: `Trop peu de questions quizz_4 (${quizz4Result.data.length}, requis ≥ ${POOL_COUP_ENVOI / 2}).`,
    };
  }
  if (cpcResult.data.length < 5) {
    return {
      ok: false,
      message: `Trop peu de questions coup_par_coup (${cpcResult.data.length}).`,
    };
  }

  // Convertit + mélange
  const allQuizz = quizz4Result.data
    .map(parseQuizz4)
    .filter((q): q is QuizzQuestion => q !== null);
  const allCpc = cpcResult.data
    .map(parseCpc)
    .filter((q): q is CpcQuestion => q !== null);

  const shuffledQuizz = shuffle(allQuizz);
  const shuffledCpc = shuffle(allCpc);

  // Coupe : moitié pour Coup d'Envoi, moitié pour duels
  const coupEnvoiPool = shuffledQuizz.slice(0, POOL_COUP_ENVOI);
  const duelsPool = shuffledQuizz.slice(
    POOL_COUP_ENVOI,
    POOL_COUP_ENVOI + POOL_DUELS,
  );
  const cpcPool = shuffledCpc.slice(0, POOL_COUP_PAR_COUP);

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
 * Persiste le state du jeu (best-effort, pour reconnexion / résumé). Appelée
 * à chaque transition de phase ou changement de turn.
 */
export async function saveDouzeCoupsState(input: {
  roomId: string;
  state: TvDouzeCoupsState;
  status?: "playing" | "paused" | "ended";
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("tv_rooms")
    .update({
      // Le state est typé Json (Supabase generated types). Notre
      // TvDouzeCoupsState est sérialisable JSONB en BDD. Cast `any`
      // local au champ uniquement (pas tout l'objet).
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
  return parseQuizz4(pick);
}

/**
 * Construit le classement final et persiste. Appelé en fin de face-à-face.
 */
export async function finalizeDouzeCoupsTv(input: {
  roomId: string;
  state: TvDouzeCoupsState;
  winnerToken: string | null;
}): Promise<void> {
  const finalRanking = buildFinalRanking(input.state.players, input.winnerToken);
  const next: TvDouzeCoupsState = {
    ...input.state,
    phase: "podium",
    finalRanking,
  };
  await saveDouzeCoupsState({
    roomId: input.roomId,
    state: next,
    status: "playing", // on reste en playing, l'hôte ferme via Quitter ou Recommencer
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Non authentifié." };

  const { error } = await supabase
    .from("tv_rooms")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "waiting", state: {} as any })
    .eq("id", roomId)
    .eq("host_id", user.id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ============================================================================
// Helpers internes (parsing BDD → types métier)
// ============================================================================

interface RawReponse {
  text: string;
  correct?: boolean;
}

function parseQuizz4(row: {
  id: string;
  enonce: string;
  reponses: unknown;
  format?: string | null;
  explication?: string | null;
  category_id?: number | null;
}): QuizzQuestion | null {
  const reponses = (row.reponses as RawReponse[]) ?? [];
  if (!Array.isArray(reponses) || reponses.length === 0) return null;
  const choices = reponses.map((r, idx) => ({ idx, text: r.text }));
  const correctIdx = reponses.findIndex((r) => r.correct === true);
  return {
    id: row.id,
    enonce: row.enonce,
    format: row.format ?? null,
    choices,
    correctIdx: Math.max(0, correctIdx),
    explication: row.explication ?? null,
    categoryId: row.category_id ?? null,
  };
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

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
