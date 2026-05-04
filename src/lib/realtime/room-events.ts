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
}

export type RoomEventName = keyof RoomEvents;
