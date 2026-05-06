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
      // Vague V (#1) — Reset l'idempotence pour la nouvelle question.
      lastAnswerKey: null,
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
    lastAnswerKey: null,
    // Vague V (#5) — Reset des bonnes trouvées (nouveau joueur, nouvelle question).
    cpcFoundIndices: [],
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
    // Vague V (#5) — Reset des vies au début de chaque phase : un joueur qui
    // arrive en CPC (orange à la fin de CE) redémarre à "vert". Le reset
    // s'applique aux non-éliminés (les éliminés conservent leur statut).
    const playersReset = s.players.map((p) =>
      p.isEliminated ? p : { ...p, lifeStatus: "green" as const },
    );
    return {
      ...s,
      phase: "coup-par-coup-playing",
      players: playersReset,
      turnOrder: newTurnOrder,
      currentPlayerIdx: 0,
      currentQuestion: firstQ,
      questionPool: {
        ...s.questionPool,
        coupParCoup: s.questionPool.coupParCoup.slice(1),
      },
      lastAnswerKey: null,
      cpcFoundIndices: [],
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
      lastAnswerKey: null,
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
  | { kind: "rejected"; reason: "wrong-token" | "wrong-question" | "no-player" | "no-question" | "duplicate" }
  | {
      kind: "accepted";
      isCorrect: boolean;
      /** Idx de référence : bonne réponse pour quizz, intrus pour CPC.
       *  Utilisé tel quel par le caller pour le broadcast `*:question-result`. */
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
  // Vague V (#1) — Idempotence : rejette un event identique au précédent
  // (même question, même joueur, même choix). Protège contre les doublons
  // d'events Realtime causés par React strict mode (double mount du
  // useEffect → handlers attachés 2x, timer de bot fired 2x).
  const answerKey = `${payload.questionId}:${payload.playerToken}:${payload.chosenIdx}`;
  if (s.lastAnswerKey === answerKey) {
    return { kind: "rejected", reason: "duplicate" };
  }
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

  // Vague V (#1.3) — `referenceIdx` est l'idx servant au broadcast (bonne
  // réponse pour quizz, intrus pour CPC). Le calcul de `isCorrect` diffère :
  // quizz → cliquer correctIdx = bon, CPC → cliquer ≠ intrusIdx = bon.
  // Avant V, le code faisait `chosenIdx === intrusIdx` pour CPC → INVERSÉ.
  const referenceIdx = isQuizzQuestion(q)
    ? q.correctIdx
    : isCpcQuestion(q)
      ? q.intrusIdx
      : -1;
  const isCorrect = isCpcQuestion(q)
    ? payload.chosenIdx !== referenceIdx
    : payload.chosenIdx === referenceIdx;
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
      lastAnswerKey: answerKey,
    };
    return {
      kind: "accepted",
      isCorrect,
      correctIdx: referenceIdx,
      next,
      triggersDuel: true,
      challengerPseudo: updated.pseudo,
    };
  }

  return {
    kind: "accepted",
    isCorrect,
    correctIdx: referenceIdx,
    next: { ...s, players: playersAfter, lastAnswerKey: answerKey },
    triggersDuel: false,
    challengerPseudo: null,
  };
}

// ============================================================================
// Vague W (#1) — Coup par Coup en TOUR PAR TOUR (refonte de V5)
// ============================================================================
//
// Mécanique cible (W1, remplace V5 continu) :
//
// - Tour de table fixe (mêmes ordres que CE) : J1 → J2 → J3 → J1 → ...
// - À chaque tour, UNE seule question CPC est affichée à TOUS les joueurs.
// - Le joueur courant clique UNE seule proposition (1 clic par tour).
//   - Bonne réponse : +1 score, foundIndices grandit, advance turn vers le
//     joueur suivant (qui voit la même question avec les bonnes déjà trouvées
//     grisées + check vert).
//   - Mauvaise (l'intrus) : vie -1, reset de foundIndices, advance turn +
//     nouvelle question CPC (sauf si rouge → duel).
// - Quand les 6 bonnes propositions ont été trouvées (par les 3 joueurs
//   cumulés sans intrus tombé) : animation "série complète" 3s, advance
//   turn + nouvelle question CPC, foundIndices reset à [].
//
// Différences avec V5 :
// - V5 disait "le joueur continue à cliquer jusqu'à intrus ou 6 bonnes".
// - W1 dit "1 clic puis advance turn dans tous les cas".
//
// Le helper ne fait PAS l'advanceTurn ni le load de nouvelle question : c'est
// le caller (host) qui s'en charge après le délai d'affichage du résultat
// (cohérence avec applyAnswer pour CE).
// ============================================================================

export interface ApplyCpcAnswerInput {
  questionId: string;
  chosenIdx: number;
  playerToken: string;
}

export type ApplyCpcAnswerResult =
  | {
      kind: "rejected";
      reason:
        | "wrong-token"
        | "wrong-question"
        | "no-player"
        | "no-question"
        | "duplicate"
        | "already-found";
    }
  | {
      // W1 — Le joueur a cliqué une bonne proposition. foundIndices grandit
      // (cumulatif). Le caller advance turn vers le joueur suivant (qui
      // verra la même question avec les bonnes grisées).
      kind: "correct-advance";
      foundIndices: number[];
      next: TvDouzeCoupsState;
    }
  | {
      // W1 — Les 6 bonnes propositions ont été trouvées au total (par les
      // 3 joueurs cumulés). Le caller broadcast l'animation "série
      // complète" puis advance turn + nouvelle question CPC.
      kind: "all-found";
      foundIndices: number[];
      next: TvDouzeCoupsState;
    }
  | {
      // Le joueur a cliqué l'intrus. Vie -1. foundIndices reset (la prochaine
      // sera une nouvelle question). Soit duel (si red), soit advance turn.
      kind: "wrong-intrus";
      intrusIdx: number;
      next: TvDouzeCoupsState;
      triggersDuel: boolean;
      challengerPseudo: string | null;
    };

/**
 * Vague W (#1) — Applique UN clic CPC sur la question courante (1 clic par
 * tour, advance turn par le caller). Refonte de V5 qui avait une mécanique
 * de continuation (le joueur cliquait plusieurs fois). Voir le bloc de
 * commentaire ci-dessus pour le détail de la mécanique cible.
 *
 * Idempotence + guard "already-found" pour éviter qu'un double-clic sur
 * une bonne proposition ne soit traité 2x (le 2e ne change rien mais on
 * le rejette explicitement pour la traçabilité).
 */
export function applyCpcAnswer(
  s: TvDouzeCoupsState,
  payload: ApplyCpcAnswerInput,
): ApplyCpcAnswerResult {
  const answerKey = `cpc:${payload.questionId}:${payload.playerToken}:${payload.chosenIdx}`;
  if (s.lastAnswerKey === answerKey) {
    return { kind: "rejected", reason: "duplicate" };
  }
  const expectedToken = s.turnOrder[s.currentPlayerIdx];
  if (payload.playerToken !== expectedToken) {
    return { kind: "rejected", reason: "wrong-token" };
  }
  const q = s.currentQuestion;
  if (!q) return { kind: "rejected", reason: "no-question" };
  if (!isCpcQuestion(q)) return { kind: "rejected", reason: "no-question" };
  if (q.id !== payload.questionId) {
    return { kind: "rejected", reason: "wrong-question" };
  }
  const player = s.players.find((p) => p.token === payload.playerToken);
  if (!player) return { kind: "rejected", reason: "no-player" };

  const found = s.cpcFoundIndices ?? [];
  if (found.includes(payload.chosenIdx)) {
    return { kind: "rejected", reason: "already-found" };
  }

  const isIntrus = payload.chosenIdx === q.intrusIdx;

  if (isIntrus) {
    // Mauvaise réponse : -1 vie. Reset de cpcFoundIndices (nouvelle question
    // CPC au tour suivant).
    const updated = applyAnswerToPlayer(player, false);
    const playersAfter = s.players.map((p) =>
      p.token === payload.playerToken ? updated : p,
    );
    const triggersDuel =
      player.lifeStatus !== "red" && updated.lifeStatus === "red";
    if (triggersDuel) {
      return {
        kind: "wrong-intrus",
        intrusIdx: q.intrusIdx,
        next: {
          ...s,
          players: playersAfter,
          phase: "coup-par-coup-duel-select",
          currentDuel: {
            challengerToken: payload.playerToken,
            candidateToken: null,
            proposedThemes: [],
            chosenThemeId: null,
            question: null,
          },
          cpcFoundIndices: [],
          lastAnswerKey: answerKey,
        },
        triggersDuel: true,
        challengerPseudo: updated.pseudo,
      };
    }
    return {
      kind: "wrong-intrus",
      intrusIdx: q.intrusIdx,
      next: {
        ...s,
        players: playersAfter,
        cpcFoundIndices: [],
        lastAnswerKey: answerKey,
      },
      triggersDuel: false,
      challengerPseudo: null,
    };
  }

  // Bonne proposition cliquée : ajout à cpcFoundIndices (cumulatif sur la
  // même question), +1 score, vie inchangée. Le caller advance turn.
  const newFound = [...found, payload.chosenIdx];
  // Compte le nombre total de propositions correctes (= toutes sauf l'intrus).
  const totalCorrect = q.propositions.filter((p) => p.correct).length;
  const playersAfter = s.players.map((p) =>
    p.token === payload.playerToken ? { ...p, score: p.score + 1 } : p,
  );
  if (newFound.length >= totalCorrect) {
    // Toutes les bonnes ont été trouvées (cumulé sur les 3 joueurs). Reset
    // foundIndices, le caller charge une nouvelle question CPC pour le
    // joueur suivant. Personne ne perd de vie.
    return {
      kind: "all-found",
      foundIndices: newFound,
      next: {
        ...s,
        players: playersAfter,
        cpcFoundIndices: [],
        lastAnswerKey: answerKey,
      },
    };
  }
  return {
    kind: "correct-advance",
    foundIndices: newFound,
    next: {
      ...s,
      players: playersAfter,
      cpcFoundIndices: newFound,
      lastAnswerKey: answerKey,
    },
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
 *
 * Vague V (#4) — Si c'était le duel n°1 (phase "coup-envoi-duel-theme"),
 * on mémorise les 2 thèmes proposés + le thème choisi dans `duelMemory`
 * pour les réutiliser au duel n°2 (en CPC), avec ce thème grisé.
 */
export function applyDuelThemeSelection(
  s: TvDouzeCoupsState,
  themeId: number,
  question: QuizzQuestion,
): TvDouzeCoupsState {
  if (!s.currentDuel) return s;
  const isDuel1 = s.phase === "coup-envoi-duel-theme";
  const questionPhase: TvGamePhase = isDuel1
    ? "coup-envoi-duel-question"
    : "coup-par-coup-duel-question";
  const newDuelMemory = isDuel1
    ? {
        proposedThemes: s.currentDuel.proposedThemes,
        chosenInDuel1: themeId,
      }
    : s.duelMemory ?? null;
  return {
    ...s,
    phase: questionPhase,
    currentDuel: {
      ...s.currentDuel,
      chosenThemeId: themeId,
      question,
    },
    duelMemory: newDuelMemory,
  };
}

export interface ApplyDuelAnswerInput {
  questionId: string;
  chosenIdx: number;
  candidateToken: string;
}

export type ApplyDuelAnswerResult =
  | { kind: "rejected"; reason: "no-duel" | "wrong-question" | "wrong-candidate" | "duplicate" }
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
  // Vague V (#1) — Idempotence sur le duel : même cle (questionId+candidate+chosenIdx).
  const duelAnswerKey = `duel:${payload.questionId}:${payload.candidateToken}:${payload.chosenIdx}`;
  if (s.lastAnswerKey === duelAnswerKey) {
    return { kind: "rejected", reason: "duplicate" };
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
        lastAnswerKey: duelAnswerKey,
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
      lastAnswerKey: duelAnswerKey,
    },
  };
}

// ============================================================================
// Vague V (#7) — Abandon de joueur (Presence leave > 30s)
// ============================================================================
//
// Mécanique : quand l'hôte détecte qu'un joueur actif (non éliminé, non bot)
// est absent depuis plus de 30s via Supabase Presence, on met la partie en
// pause. L'hôte voit un modal avec 3 options :
//  - Continuer : éliminer le joueur, advance turn si c'était son tour, et
//    tenter une transition de phase si on franchit le seuil.
//  - Attendre : ne rien faire, garder la pause active jusqu'à ce que le
//    joueur revienne (ou que l'hôte décide une autre option plus tard).
//  - Remplacer par bot : le joueur garde son token / pseudo / avatar mais
//    devient un bot avec un skill réglable.
//
// Les helpers ici sont purs et testables. Les server actions associées
// (`abandon-actions.ts`) chargent le state, appliquent un helper, sauvent.
// ============================================================================

/**
 * Met la partie en pause à cause de l'abandon d'un joueur. Idempotent : si
 * déjà en pause, ne change rien (garde le 1er joueur qui a quitté).
 */
export function applyPlayerLeftPause(
  s: TvDouzeCoupsState,
  token: string,
  pseudo: string,
): TvDouzeCoupsState {
  if (s.pausedReason) return s;
  return {
    ...s,
    pausedReason: "player-left",
    pausedPlayerToken: token,
    pausedPlayerPseudo: pseudo,
  };
}

/** Reset les 3 champs de pause. Helper privé utilisé par les autres applies. */
function clearPause(s: TvDouzeCoupsState): TvDouzeCoupsState {
  return {
    ...s,
    pausedReason: null,
    pausedPlayerToken: null,
    pausedPlayerPseudo: null,
  };
}

export function applyResume(s: TvDouzeCoupsState): TvDouzeCoupsState {
  return clearPause(s);
}

/**
 * Élimine le joueur qui a quitté + reprend la partie. Si c'était son tour,
 * advance turn. Si l'élimination franchit le seuil de phase
 * (CE→CPC ≤3 vivants, CPC→FA ≤2), tente la transition.
 *
 * Retourne `null` si le token n'existe pas ou que le joueur est déjà éliminé.
 */
export function applyEliminateLeftPlayer(
  s: TvDouzeCoupsState,
  token: string,
  now: number = Date.now(),
): TvDouzeCoupsState | null {
  const player = s.players.find((p) => p.token === token);
  if (!player || player.isEliminated) return null;
  const phaseKind: "coup-envoi" | "coup-par-coup" = s.phase.startsWith(
    "coup-envoi",
  )
    ? "coup-envoi"
    : "coup-par-coup";
  const playersAfter = s.players.map((p) =>
    p.token === token
      ? {
          ...p,
          isEliminated: true,
          eliminatedAt: now,
          eliminatedInPhase: phaseKind,
        }
      : p,
  );
  const baseState = clearPause({ ...s, players: playersAfter });

  // Tente une transition de phase si seuil franchi
  const transitioned = transitionAfterElimination(baseState);
  if (transitioned) return transitioned;

  // Si c'était le tour du joueur éliminé, advance turn (sinon tour inchangé)
  const currentToken = s.turnOrder[s.currentPlayerIdx];
  if (currentToken === token) {
    return advanceTurn(baseState);
  }
  return baseState;
}

/**
 * Transforme un joueur humain en bot (garde son token / pseudo / avatar).
 * Reset la pause. Le `botSkill` est borné [0..100].
 *
 * Retourne `null` si le token n'existe pas ou si le joueur est déjà éliminé
 * (un éliminé n'a pas vocation à devenir bot).
 */
export function applyConvertToBot(
  s: TvDouzeCoupsState,
  token: string,
  botSkill: number,
): TvDouzeCoupsState | null {
  const idx = s.players.findIndex((p) => p.token === token);
  if (idx === -1) return null;
  const player = s.players[idx]!;
  if (player.isEliminated) return null;
  const skill = Math.max(0, Math.min(100, botSkill));
  const playersAfter = [...s.players];
  playersAfter[idx] = { ...player, isBot: true, botSkill: skill };
  return clearPause({ ...s, players: playersAfter });
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
