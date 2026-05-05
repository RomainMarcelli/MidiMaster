/**
 * Types des évènements échangés sur le channel Realtime `room:{code}`.
 *
 * Anti-cheat : les events de l'hôte vers les téléphones ne contiennent
 * JAMAIS la bonne réponse. Les téléphones reçoivent l'index/le contenu
 * des choix mais ne savent pas lequel est correct ; c'est l'hôte qui
 * compare la réponse reçue (event `answer:submit`) à l'état serveur.
 */

export interface QuestionShowPayload {
  /** ID de question (utile pour debug / dédup côté client). */
  questionId: string;
  /** Énoncé textuel. */
  enonce: string;
  /** Format optionnel (vrai/faux, à choix multiples, etc.). */
  format?: string | null;
  /** Choix proposés. PAS de marqueur "correct" envoyé. */
  choices: Array<{ idx: number; text: string }>;
  /** Token du joueur dont c'est le tour. Les autres joueurs voient "X joue". */
  currentPlayerToken: string;
  /** Pseudo du joueur dont c'est le tour (pour affichage). */
  currentPlayerPseudo: string;
  /** Timer en secondes (optionnel). */
  timerSeconds?: number;
}

export interface QuestionResultPayload {
  questionId: string;
  /** Token du joueur qui vient de répondre. */
  byToken: string;
  /** Indice choisi par le joueur (-1 si timeout). */
  chosenIdx: number;
  /** Indice de la bonne réponse (révélé après la réponse). */
  correctIdx: number;
  /** True si la réponse était correcte. */
  isCorrect: boolean;
  /** Explication optionnelle à afficher après. */
  explication?: string | null;
}

export interface PhaseChangePayload {
  /** Nouvelle phase de la partie (jeu1, duel, jeu2, faceaface, results). */
  phase: string;
}

export interface PlayerStateChangePayload {
  token: string;
  /** Score / cagnotte courante. */
  cagnotte: number;
  errors: number;
  isEliminated: boolean;
}

export interface PauseResumePayload {
  reason?: string;
}

export interface AnswerSubmitPayload {
  questionId: string;
  /** Index choisi par le joueur. */
  chosenIdx: number;
  /** Token du joueur qui répond (vérifié côté hôte). */
  playerToken: string;
}

export interface HeartbeatPayload {
  playerToken: string;
}

// =============================================================================
// P5.1 — Events face-à-face (2 finalistes, vote présentateur, timer par joueur)
// =============================================================================

export interface FaVoteStartPayload {
  /** Tokens des 2 finalistes proposés au vote. */
  finalists: string[];
  /** Pseudos correspondants pour affichage. */
  finalistPseudos: Record<string, string>;
}

export interface FaVoteCastPayload {
  /** Token du votant. */
  voterToken: string;
  /** Token choisi (un des finalistes). */
  forToken: string;
}

export interface FaVoteResultPayload {
  /** Le présentateur choisi (majorité ou aléatoire en cas d'égalité). */
  presenterToken: string;
  /** L'autre finaliste, qui devient challenger. */
  challengerToken: string;
}

export interface FaQuestionPayload {
  questionId: string;
  enonce: string;
  /** Le challenger qui doit répondre (seul joueur dont le timer décompte). */
  currentChallengerToken: string;
  /** Timers en secondes par token de finaliste. */
  timers: Record<string, number>;
}

export interface FaTickPayload {
  /** Token du joueur dont le timer décompte. */
  token: string;
  /** Secondes restantes. */
  remaining: number;
}

export interface FaAnswerPayload {
  /** Token du présentateur qui valide. */
  presenterToken: string;
  /** Token du challenger validé. */
  challengerToken: string;
  isCorrect: boolean;
}

export interface FaEndPayload {
  /** Token du gagnant. */
  winnerToken: string;
  /** Token du perdant. */
  loserToken: string;
}

/** Map nom d'event → payload. Sert au typage strict du channel Realtime. */
export interface RoomEvents {
  "question:show": QuestionShowPayload;
  "question:result": QuestionResultPayload;
  "phase:change": PhaseChangePayload;
  "player:state": PlayerStateChangePayload;
  "player:eliminated": { token: string };
  "player:winner": { token: string };
  "room:paused": PauseResumePayload;
  "room:resumed": PauseResumePayload;
  /**
   * Q3.1 — L'hôte a fermé la partie. Tous les joueurs sont notifiés
   * pour afficher un écran de redirection.
   */
  "room:closed": { reason?: string };
  "answer:submit": AnswerSubmitPayload;
  heartbeat: HeartbeatPayload;
  // P5.1 — Face-à-face
  "fa:vote-start": FaVoteStartPayload;
  "fa:vote-cast": FaVoteCastPayload;
  "fa:vote-result": FaVoteResultPayload;
  "fa:question": FaQuestionPayload;
  "fa:tick": FaTickPayload;
  /** Le présentateur clique "GO" pour démarrer le timer du challenger. */
  "fa:go": { presenterToken: string };
  "fa:answer": FaAnswerPayload;
  "fa:end": FaEndPayload;
  // ==========================================================================
  // Vague R — Mode 12 Coups TV (Coup d'Envoi + Coup par Coup + duels)
  // ==========================================================================
  /** Broadcast d'une nouvelle question Coup d'Envoi (quizz_4). */
  "ce:question-show": {
    questionId: string;
    enonce: string;
    format: string | null;
    choices: Array<{ idx: number; text: string }>;
    currentPlayerToken: string;
    currentPlayerPseudo: string;
  };
  /** Réponse d'un joueur à une question Coup d'Envoi. */
  "ce:answer-submit": {
    questionId: string;
    chosenIdx: number;
    playerToken: string;
  };
  /** Résultat de la réponse + transition (broadcast par la TV). */
  "ce:question-result": {
    questionId: string;
    byToken: string;
    chosenIdx: number;
    correctIdx: number;
    isCorrect: boolean;
    explication?: string | null;
  };
  /** Un joueur tombe au rouge — démarrage du duel. */
  "ce:duel-start": {
    challengerToken: string;
    challengerPseudo: string;
  };
  /** Le challenger a choisi son candidat. */
  "ce:duel-candidate-selected": {
    challengerToken: string;
    candidateToken: string;
    candidatePseudo: string;
  };
  /** Les 2 thèmes proposés au candidat. */
  "ce:duel-theme-proposals": {
    candidateToken: string;
    themes: Array<{ id: number; slug: string; nom: string }>;
  };
  /** Le candidat a choisi son thème. */
  "ce:duel-theme-chosen": {
    candidateToken: string;
    themeId: number;
    themeNom: string;
  };
  /** Question du duel (quizz_4). */
  "ce:duel-question": {
    questionId: string;
    enonce: string;
    choices: Array<{ idx: number; text: string }>;
    candidateToken: string;
  };
  /** Réponse du candidat au duel. */
  "ce:duel-answer-submit": {
    questionId: string;
    chosenIdx: number;
    candidateToken: string;
  };
  /** Résultat du duel. */
  "ce:duel-result": {
    questionId: string;
    candidateToken: string;
    challengerToken: string;
    chosenIdx: number;
    correctIdx: number;
    candidateCorrect: boolean;
    /** True si le challenger est éliminé suite au duel. */
    challengerEliminated: boolean;
  };
  /** Animation d'élimination de fin de phase. */
  "ce:elimination": {
    eliminatedToken: string;
    eliminatedPseudo: string;
    /** Phase qui se termine (suivant = nouvelle phase). */
    fromPhase: "coup-envoi" | "coup-par-coup";
    nextPhase: "coup-par-coup" | "face-a-face";
  };
  // -- Coup par Coup (R2)
  /** Broadcast d'une nouvelle question Coup par Coup (intrus parmi 7). */
  "cpc:question-show": {
    questionId: string;
    /** Thème (libellé) — ex. "Rivières françaises" */
    enonce: string;
    propositions: Array<{ idx: number; text: string }>;
    currentPlayerToken: string;
    currentPlayerPseudo: string;
  };
  /** Réponse Coup par Coup (clic sur une proposition, qu'elle soit l'intrus ou non). */
  "cpc:answer-submit": {
    questionId: string;
    chosenIdx: number;
    playerToken: string;
  };
  /** Résultat de la réponse + transition. */
  "cpc:question-result": {
    questionId: string;
    byToken: string;
    chosenIdx: number;
    intrusIdx: number;
    isCorrect: boolean;
    explication?: string | null;
  };
  // -- Phase / Podium / Restart (R3)
  /** Changement de phase global du mode 12 Coups TV. */
  "dc:phase-change": {
    phase: string;
  };
  /** L'hôte a relancé une partie depuis le podium → reset au lobby. */
  "room:restart": Record<string, never>;
}

export type RoomEventName = keyof RoomEvents;
