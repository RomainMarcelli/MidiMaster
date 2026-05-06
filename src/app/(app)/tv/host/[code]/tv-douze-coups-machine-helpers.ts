/**
 * Vague T (#3) — State machine pure du mode 12 Coups TV.
 *
 * Extraction des transitions PURES depuis l'orchestrateur React
 * `tv-douze-coups-host.tsx` (qui mélangeait state machine, broadcast
 * Realtime, persistence et UI). Toutes ces fonctions :
 *  - Prennent un `TvDouzeCoupsState` + un payload typé.
 *  - Retournent un nouveau state (immutable, jamais de mutation).
 *  - N'ont AUCUN side effect (pas de Supabase, pas de broadcast, pas
 *    de setTimeout, pas de Date.now() — l'horodatage est injecté).
 *  - Sont testables en environnement Node sans React.
 *
 * Le composant React reste responsable de :
 *  - Brancher le channel Realtime (broadcast, on)
 *  - Appeler `saveDouzeCoupsState` à la suite de chaque transition
 *  - Planifier les setTimeout (animations, délais bot)
 *  - Déclencher la simulation des bots
 */

import {
  applyAnswerToPlayer,
  isCpcQuestion,
  isQuizzQuestion,
  markFinalists,
  nextActivePlayerIdx,
  resolveDuel,
  type DuelTheme,
  type QuizzQuestion,
  type TvDouzeCoupsState,
  type TvGamePhase,
} from "@/lib/realtime/tv-douze-coups-state";

// ============================================================================
// Avancement de tour (sans transition de phase)
// ============================================================================

/**
 * Avance au prochain joueur actif dans `turnOrder` (saute les éliminés)
 * et tire la prochaine question du pool de la phase courante. Ne fait
 * AUCUNE transition de phase — c'est `transitionAfterElimination` qui
 * s'en charge UNIQUEMENT après une élimination effective.
 *
 * Si tous les joueurs sont éliminés, `currentPlayerIdx` reste inchangé
 * (le caller doit déjà avoir détecté la fin de partie via `aliveCount`).
 */
export function advanceTurn(s: TvDouzeCoupsState): TvDouzeCoupsState {
  const nextIdx = nextActivePlayerIdx(
    s.currentPlayerIdx,
    s.turnOrder,
    s.players,
  );
  if (s.phase === "coup-envoi-playing") {
    const nextQuestion = s.questionPool.coupEnvoi[0] ?? null;
    return {
      ...s,
      currentPlayerIdx: nextIdx === -1 ? s.currentPlayerIdx : nextIdx,
      currentQuestion: nextQuestion,
      questionPool: {
        ...s.questionPool,
        coupEnvoi: s.questionPool.coupEnvoi.slice(1),
      },
    };
  }
  // Toutes les autres phases (CPC + duels + élim) avancent dans le pool CPC.
  const nextQuestion = s.questionPool.coupParCoup[0] ?? null;
  return {
    ...s,
    currentPlayerIdx: nextIdx === -1 ? s.currentPlayerIdx : nextIdx,
    currentQuestion: nextQuestion,
    questionPool: {
      ...s.questionPool,
      coupParCoup: s.questionPool.coupParCoup.slice(1),
    },
  };
}

// ============================================================================
// Transition de phase après élimination
// ============================================================================

/**
 * Décide si l'élimination effective d'un joueur doit déclencher un
 * changement de phase (CE → CPC, CPC → FA). Retourne le state mis à
 * jour avec la nouvelle phase, OU `null` si on reste dans la même phase
 * (cas où on a éliminé un joueur mais on est encore au-dessus du seuil).
 *
 * Règles :
 *  - Coup d'Envoi → Coup par Coup quand il reste ≤ 3 vivants
 *  - Coup par Coup → Face-à-Face quand il reste ≤ 2 vivants
 *
 * Idempotente : si appelée alors que la phase est déjà la suivante, ne
 * fait rien.
 */
export function transitionAfterElimination(
  s: TvDouzeCoupsState,
): TvDouzeCoupsState | null {
  const alive = s.players.filter((p) => !p.isEliminated);
  if (
    (s.phase === "coup-envoi-playing" ||
      s.phase === "coup-envoi-elimination") &&
    alive.length <= 3
  ) {
    const newTurnOrder = alive.map((p) => p.token);
    const firstQ = s.questionPool.coupParCoup[0] ?? null;
    return {
      ...s,
      phase: "coup-par-coup-playing",
      turnOrder: newTurnOrder,
      currentPlayerIdx: 0,
      currentQuestion: firstQ,
      questionPool: {
        ...s.questionPool,
        coupParCoup: s.questionPool.coupParCoup.slice(1),
      },
    };
  }
  if (
    (s.phase === "coup-par-coup-playing" ||
      s.phase === "coup-par-coup-elimination") &&
    alive.length <= 2
  ) {
    return {
      ...s,
      phase: "face-a-face-vote",
      players: markFinalists(s.players),
    };
  }
  return null;
}

// ============================================================================
// Réponse à une question normale (Coup d'Envoi ou Coup par Coup)
// ============================================================================

export type AnswerKind = "ce" | "cpc";

export interface ApplyAnswerInput {
  questionId: string;
  chosenIdx: number;
  playerToken: string;
}

export type ApplyAnswerResult =
  | { kind: "rejected"; reason: "wrong-token" | "wrong-question" | "no-player" | "no-question" }
  | {
      kind: "accepted";
      isCorrect: boolean;
      correctIdx: number;
      /** State après l'application de la réponse (vie + score + éventuellement passage en duel). */
      next: TvDouzeCoupsState;
      /** True si la réponse a fait passer le joueur au rouge → un duel démarre. */
      triggersDuel: boolean;
      /** Pseudo du challenger (joueur qui passe rouge), pour le broadcast `*:duel-start`. */
      challengerPseudo: string | null;
    };

/**
 * Applique une réponse à la question courante d'un joueur. Vérifie
 * d'abord que le joueur est bien celui dont c'est le tour ET que la
 * question correspond à `currentQuestion`. Retourne soit `rejected`
 * (avec une raison), soit `accepted` avec :
 *  - le state mis à jour (vie ajustée, score incrémenté si correct)
 *  - un flag `triggersDuel` si le joueur vient de passer au rouge
 *
 * Ne fait AUCUN broadcast / save — c'est au caller (host) de le faire
 * sur la base du résultat.
 */
export function applyAnswer(
  s: TvDouzeCoupsState,
  payload: ApplyAnswerInput,
  kind: AnswerKind,
): ApplyAnswerResult {
  const expectedToken = s.turnOrder[s.currentPlayerIdx];
  if (payload.playerToken !== expectedToken) {
    return { kind: "rejected", reason: "wrong-token" };
  }
  const q = s.currentQuestion;
  if (!q) return { kind: "rejected", reason: "no-question" };
  if (q.id !== payload.questionId) {
    return { kind: "rejected", reason: "wrong-question" };
  }
  const player = s.players.find((p) => p.token === payload.playerToken);
  if (!player) return { kind: "rejected", reason: "no-player" };

  const correctIdx = isQuizzQuestion(q)
    ? q.correctIdx
    : isCpcQuestion(q)
      ? q.intrusIdx
      : -1;
  const isCorrect = payload.chosenIdx === correctIdx;
  const updated = applyAnswerToPlayer(player, isCorrect);
  const playersAfter = s.players.map((p) =>
    p.token === payload.playerToken ? updated : p,
  );
  const triggersDuel =
    player.lifeStatus !== "red" && updated.lifeStatus === "red";

  if (triggersDuel) {
    const duelPhase: TvGamePhase =
      kind === "ce" ? "coup-envoi-duel-select" : "coup-par-coup-duel-select";
    const next: TvDouzeCoupsState = {
      ...s,
      players: playersAfter,
      phase: duelPhase,
      currentDuel: {
        challengerToken: payload.playerToken,
        candidateToken: null,
        proposedThemes: [],
        chosenThemeId: null,
        question: null,
      },
    };
    return {
      kind: "accepted",
      isCorrect,
      correctIdx,
      next,
      triggersDuel: true,
      challengerPseudo: updated.pseudo,
    };
  }

  return {
    kind: "accepted",
    isCorrect,
    correctIdx,
    next: { ...s, players: playersAfter },
    triggersDuel: false,
    challengerPseudo: null,
  };
}

// ============================================================================
// Transitions du flux duel
// ============================================================================

/**
 * Le challenger a désigné un candidat. On enregistre dans `currentDuel`
 * et on bascule en sub-phase "duel-theme" (en attendant le choix de
 * thème par le candidat).
 */
export function applyDuelCandidateSelection(
  s: TvDouzeCoupsState,
  candidateToken: string,
  proposedThemes: DuelTheme[],
): TvDouzeCoupsState {
  if (!s.currentDuel) return s;
  const themePhase: TvGamePhase = s.phase === "coup-envoi-duel-select"
    ? "coup-envoi-duel-theme"
    : "coup-par-coup-duel-theme";
  return {
    ...s,
    phase: themePhase,
    currentDuel: {
      ...s.currentDuel,
      candidateToken,
      proposedThemes,
    },
  };
}

/**
 * Le candidat a choisi son thème. On charge la question quizz_4
 * correspondante (déjà fait côté caller via `pickDuelQuestion`) et on
 * bascule en sub-phase "duel-question".
 */
export function applyDuelThemeSelection(
  s: TvDouzeCoupsState,
  themeId: number,
  question: QuizzQuestion,
): TvDouzeCoupsState {
  if (!s.currentDuel) return s;
  const questionPhase: TvGamePhase =
    s.phase === "coup-envoi-duel-theme"
      ? "coup-envoi-duel-question"
      : "coup-par-coup-duel-question";
  return {
    ...s,
    phase: questionPhase,
    currentDuel: {
      ...s.currentDuel,
      chosenThemeId: themeId,
      question,
    },
  };
}

export interface ApplyDuelAnswerInput {
  questionId: string;
  chosenIdx: number;
  candidateToken: string;
}

export type ApplyDuelAnswerResult =
  | { kind: "rejected"; reason: "no-duel" | "wrong-question" | "wrong-candidate" }
  | {
      kind: "accepted";
      candidateCorrect: boolean;
      correctIdx: number;
      challengerEliminated: boolean;
      /** Pseudo du joueur éliminé (pour overlay), null si personne. */
      eliminatedPseudo: string | null;
      /** State après l'application — soit phase "elimination" (4.5s), soit retour playing. */
      next: TvDouzeCoupsState;
      phaseKind: "coup-envoi" | "coup-par-coup";
    };

/**
 * Le candidat a répondu au duel. Applique `resolveDuel` (élimination
 * conditionnelle) et bascule en sub-phase "elimination" (avec
 * `eliminationAnimation`) si le challenger est out, ou retire
 * `currentDuel` et continue normalement sinon.
 *
 * `now` injectable pour les tests (default `Date.now()`).
 */
export function applyDuelAnswer(
  s: TvDouzeCoupsState,
  payload: ApplyDuelAnswerInput,
  options: { now?: number; eliminationDurationMs?: number } = {},
): ApplyDuelAnswerResult {
  const now = options.now ?? Date.now();
  const elimDuration = options.eliminationDurationMs ?? 4500;

  const duel = s.currentDuel;
  if (!duel || !duel.question) return { kind: "rejected", reason: "no-duel" };
  if (duel.question.id !== payload.questionId) {
    return { kind: "rejected", reason: "wrong-question" };
  }
  if (payload.candidateToken !== duel.candidateToken) {
    return { kind: "rejected", reason: "wrong-candidate" };
  }
  if (duel.candidateToken === null) {
    return { kind: "rejected", reason: "wrong-candidate" };
  }

  const candidateCorrect = payload.chosenIdx === duel.question.correctIdx;
  const phaseKind: "coup-envoi" | "coup-par-coup" = s.phase.startsWith(
    "coup-envoi",
  )
    ? "coup-envoi"
    : "coup-par-coup";
  const playersAfter = resolveDuel(
    s.players,
    duel.challengerToken,
    duel.candidateToken,
    candidateCorrect,
    phaseKind,
    now,
  );
  const eliminatedPlayer = playersAfter.find(
    (p) => p.token === duel.challengerToken && p.isEliminated,
  );
  const challengerEliminated = !!eliminatedPlayer;

  if (challengerEliminated && eliminatedPlayer) {
    const elimPhase: TvGamePhase =
      phaseKind === "coup-envoi"
        ? "coup-envoi-elimination"
        : "coup-par-coup-elimination";
    return {
      kind: "accepted",
      candidateCorrect,
      correctIdx: duel.question.correctIdx,
      challengerEliminated: true,
      eliminatedPseudo: eliminatedPlayer.pseudo,
      phaseKind,
      next: {
        ...s,
        players: playersAfter,
        currentDuel: null,
        phase: elimPhase,
        eliminationAnimation: {
          token: duel.challengerToken,
          startedAt: now,
          durationMs: elimDuration,
        },
      },
    };
  }

  // Le challenger survit — on retire le duel et on revient à la sub-phase
  // "playing" pour que le caller puisse appeler `advanceTurn`.
  const playingPhase: TvGamePhase =
    phaseKind === "coup-envoi" ? "coup-envoi-playing" : "coup-par-coup-playing";
  return {
    kind: "accepted",
    candidateCorrect,
    correctIdx: duel.question.correctIdx,
    challengerEliminated: false,
    eliminatedPseudo: null,
    phaseKind,
    next: {
      ...s,
      players: playersAfter,
      currentDuel: null,
      phase: playingPhase,
    },
  };
}

/**
 * Termine la phase "elimination" (après l'animation 4.5s) : retourne
 * en phase playing puis tente une transition vers la phase suivante.
 * Retourne le state final + un flag `transitioned` indiquant si on a
 * changé de phase (utile pour décider de broadcaster ou non).
 */
export function endEliminationAnimation(
  s: TvDouzeCoupsState,
): { next: TvDouzeCoupsState; transitioned: boolean } {
  const phaseKind: "coup-envoi" | "coup-par-coup" = s.phase.startsWith(
    "coup-envoi",
  )
    ? "coup-envoi"
    : "coup-par-coup";
  const back: TvDouzeCoupsState = {
    ...s,
    phase:
      phaseKind === "coup-envoi"
        ? "coup-envoi-playing"
        : "coup-par-coup-playing",
    eliminationAnimation: null,
  };
  const transitioned = transitionAfterElimination(back);
  if (transitioned) return { next: transitioned, transitioned: true };
  return { next: advanceTurn(back), transitioned: false };
}
