/**
 * Vague R — État sérialisé du mode "12 Coups TV" (mode soirée multi-joueur
 * avec 3 étapes enchaînées). Stocké entièrement dans `tv_rooms.state` JSONB.
 *
 * Mécanique :
 *  - Étape 1 (Coup d'Envoi) : 4 joueurs, questions quizz_2 (boutons A/B)
 *    tour par tour, système de 2 vies (vert → orange → rouge). Quand un
 *    joueur tombe au rouge, un DUEL est déclenché : il choisit un
 *    candidat, le candidat choisit 1 thème parmi 2, et répond à 1
 *    question quizz_4 (4 choix, plus difficile pour départager). Si le
 *    candidat a bon → X éliminé. Sinon → X reste rouge mais survit.
 *  - Étape 2 (Coup par Coup) : 3 survivants, questions coup_par_coup
 *    (intrus parmi 7 propositions), même système de vies + duels (quizz_4).
 *  - Étape 3 (Face-à-Face) : 2 finalistes, géré par le module P5
 *    (face-a-face-state.ts) — déclenché automatiquement à la fin du
 *    Coup par Coup.
 *
 * Vague T — Le mode TV legacy quizz_2 (`tv-game-state.ts`, `tv-game-actions.ts`)
 * a été supprimé. Le 12 Coups TV est désormais le seul mode TV. La phase
 * Coup d'Envoi utilise des questions quizz_2 pour les boutons A/B.
 */

export type LifeStatus = "green" | "orange" | "red";

export type TvGamePhase =
  | "lobby"
  // Étape 1 — Coup d'Envoi
  | "coup-envoi-playing"        // tour de table en cours
  | "coup-envoi-duel-select"    // X choisit son candidat
  | "coup-envoi-duel-theme"     // candidat choisit son thème
  | "coup-envoi-duel-question"  // candidat répond à la question
  | "coup-envoi-elimination"    // animation 4-5s "X éliminé"
  // Étape 2 — Coup par Coup
  | "coup-par-coup-playing"
  | "coup-par-coup-duel-select"
  | "coup-par-coup-duel-theme"
  | "coup-par-coup-duel-question"
  | "coup-par-coup-elimination"
  // Étape 3 — Face-à-Face (état géré par face-a-face-state.ts)
  | "face-a-face-vote"
  | "face-a-face-playing"
  // Final
  | "podium";

/**
 * Question type quizz (2 ou 4 choix). Vague T : utilisée pour Coup d'Envoi
 * (quizz_2, A/B) et pour les duels (quizz_4, A/B/C/D). Le format diffère
 * uniquement par le nombre de `choices` ; le parser et l'affichage sont
 * identiques.
 */
export interface QuizzQuestion {
  id: string;
  enonce: string;
  format?: string | null;
  /** N choix avec un seul correct (N=2 pour Coup d'Envoi, N=4 pour duels).
   *  Le correctIdx ne doit pas être broadcast aux téléphones. */
  choices: Array<{ idx: number; text: string }>;
  correctIdx: number;
  explication?: string | null;
  /** Catégorie (utile pour les duels par thème). */
  categoryId: number | null;
}

/** Question coup_par_coup : 7 propositions dont 1 intrus. */
export interface CpcQuestion {
  id: string;
  /** Thème (ex. "Rivières françaises"). */
  enonce: string;
  /** Les 7 propositions. `correct: false` = l'intrus à trouver. */
  propositions: Array<{ idx: number; text: string; correct: boolean }>;
  /** Index de l'intrus (= proposition avec correct=false). */
  intrusIdx: number;
  explication?: string | null;
}

export interface DcPlayer {
  token: string;
  pseudo: string;
  avatarUrl: string | null;
  lifeStatus: LifeStatus;
  isEliminated: boolean;
  eliminatedAt: number | null;
  eliminatedInPhase: "coup-envoi" | "coup-par-coup" | null;
  /** Score (bonnes réponses cumulées toutes phases). Pour l'affichage. */
  score: number;
  /** True si finaliste du face-à-face (= 1 des 2 derniers debout). */
  isFinalist: boolean;
  /** Vague S3 — true si bot IA (réponses simulées par l'orchestrateur). */
  isBot?: boolean;
  /** Vague S3 — taux de réussite du bot (0..100). Default 70. */
  botSkill?: number;
}

/** Catégorie proposée dans un duel (slug + nom pour l'UI). */
export interface DuelTheme {
  id: number;
  slug: string;
  nom: string;
}

export interface PendingDuel {
  /** Joueur qui est tombé au rouge et déclenche le duel. */
  challengerToken: string;
  /** Candidat choisi par le challenger. Null tant que pas choisi. */
  candidateToken: string | null;
  /** 2 catégories proposées au candidat. */
  proposedThemes: DuelTheme[];
  /** Thème choisi par le candidat. Null tant que pas choisi. */
  chosenThemeId: number | null;
  /** Question quizz_4 chargée à partir du thème choisi. */
  question: QuizzQuestion | null;
}

export interface EliminationAnimation {
  token: string;
  startedAt: number;
  durationMs: number;
}

export interface FinalRanking {
  token: string;
  pseudo: string;
  rank: 1 | 2 | 3 | 4;
}

export interface TvDouzeCoupsState {
  phase: TvGamePhase;
  players: DcPlayer[];
  /** Ordre du tour de table fixe pour la phase courante (tokens). */
  turnOrder: string[];
  /** Index dans turnOrder (joueur dont c'est le tour). */
  currentPlayerIdx: number;
  /** Question en cours d'affichage (Coup d'Envoi : quizz_2 ; CPC : coup_par_coup ; duels : quizz_4). */
  currentQuestion: QuizzQuestion | CpcQuestion | null;
  /** Données du duel en cours (null si phase normale). */
  currentDuel: PendingDuel | null;
  /** Animation d'élimination en cours (null sinon). */
  eliminationAnimation: EliminationAnimation | null;
  /** Pool de questions disponibles pour la phase courante. */
  questionPool: {
    coupEnvoi: QuizzQuestion[];
    coupParCoup: CpcQuestion[];
    duels: QuizzQuestion[];
  };
  /** Présentateur du face-à-face (token). Null avant désignation. */
  faceAFacePresenterToken: string | null;
  /** Mode de désignation du présentateur ("random" | "vote"). */
  presenterDesignationMode: "random" | "vote";
  /** Classement final (rempli en phase "podium"). */
  finalRanking: FinalRanking[] | null;
  /**
   * Vague V (#1) — Cle d'idempotence sur la derniere reponse acceptee.
   * Permet de rejeter les events `*:answer-submit` doublonnes (React strict
   * mode qui re-attache les handlers Realtime, timer de bot relance, etc.)
   * sans avoir a cleanup ces side effects. Forme: `{questionId}:{playerToken}:{chosenIdx}`.
   * Reset implicite : devient stale quand la question courante change (id different).
   */
  lastAnswerKey?: string | null;
  /**
   * Vague V (#5) — Mecanique CPC en continu : tableau des idx deja
   * trouves (propositions liees) sur la question courante. Le joueur
   * courant continue a cliquer tant qu'il ne tombe pas sur l'intrus
   * OU qu'il n'a pas trouve les 6 bonnes (serie complete). Reset a
   * chaque advanceTurn (nouvelle question = nouveau departement).
   */
  cpcFoundIndices?: number[];
  /**
   * Vague V (#4) — Memoire des themes proposes au duel n°1 (en CE).
   * Reutilises au duel n°2 (en CPC) avec le theme deja choisi grise.
   * Si null, c'est qu'aucun duel n'a encore eu lieu (ou que la partie
   * vient d'etre cree en pre-V).
   */
  duelMemory?: {
    /** Les 2 themes tires au duel n°1. */
    proposedThemes: DuelTheme[];
    /** Id du theme choisi au duel n°1 (grise au duel n°2). */
    chosenInDuel1: number;
  } | null;
  /**
   * Vague V (#7) — Pause causee par l'abandon d'un joueur (Presence leave
   * > 30s detectee cote host). Quand non null, l'orchestrateur ignore les
   * events `*:answer-submit` entrants et les telephones affichent un
   * overlay "Partie en pause". Reset par les server actions
   * `eliminatePlayerForLeaving` / `replaceLeftPlayerWithBot`.
   */
  pausedReason?: "player-left" | null;
  /** Token du joueur ayant declenche la pause. */
  pausedPlayerToken?: string | null;
  /** Pseudo du joueur ayant declenche la pause (cache pour l'UI modal). */
  pausedPlayerPseudo?: string | null;
}

// ============================================================================
// HELPERS PURS — testables en isolation
// ============================================================================

/** Mappe le nombre d'erreurs (0/1/2+) → état de vie. */
export function lifeStatusFromErrors(errors: number): LifeStatus {
  if (errors <= 0) return "green";
  if (errors === 1) return "orange";
  return "red";
}

/** Compte les joueurs non éliminés. */
export function aliveCount(players: DcPlayer[]): number {
  return players.filter((p) => !p.isEliminated).length;
}

/**
 * Renvoie l'index du prochain joueur actif dans turnOrder, en sautant les
 * éliminés. Retourne -1 si tous sont éliminés.
 */
export function nextActivePlayerIdx(
  currentIdx: number,
  turnOrder: string[],
  players: DcPlayer[],
): number {
  if (turnOrder.length === 0) return -1;
  const playerByToken = new Map(players.map((p) => [p.token, p]));
  for (let step = 1; step <= turnOrder.length; step++) {
    const candidate = (currentIdx + step) % turnOrder.length;
    const token = turnOrder[candidate]!;
    const p = playerByToken.get(token);
    if (p && !p.isEliminated) return candidate;
  }
  return -1;
}

/**
 * Applique une réponse à une question normale (hors duel). Retourne le
 * nouvel état du joueur :
 *  - bonne réponse → vie inchangée, +1 score
 *  - mauvaise réponse → vie dégradée (green→orange→red), pas de point
 *
 * Le passage au rouge ne déclenche PAS le duel ici (c'est au caller de
 * regarder le `lifeStatus` final et de transitionner si besoin).
 */
export function applyAnswerToPlayer(
  player: DcPlayer,
  isCorrect: boolean,
): DcPlayer {
  if (isCorrect) {
    return { ...player, score: player.score + 1 };
  }
  // Erreur : on dégrade la vie d'un cran
  let next: LifeStatus = player.lifeStatus;
  if (player.lifeStatus === "green") next = "orange";
  else if (player.lifeStatus === "orange") next = "red";
  return { ...player, lifeStatus: next };
}

/**
 * Résout un duel : applique l'élimination conditionnelle.
 *  - candidat bien répond → challenger éliminé immédiatement
 *  - candidat mal répond → challenger reste au rouge mais survit
 *
 * Le candidat n'est jamais pénalisé.
 */
export function resolveDuel(
  players: DcPlayer[],
  challengerToken: string,
  candidateToken: string,
  candidateAnswerCorrect: boolean,
  phase: "coup-envoi" | "coup-par-coup",
  now: number = Date.now(),
): DcPlayer[] {
  if (!candidateAnswerCorrect) {
    // Le challenger survit, rien ne change (le rouge reste rouge)
    return players;
  }
  // Candidat bon → challenger éliminé
  return players.map((p) =>
    p.token === challengerToken
      ? {
          ...p,
          isEliminated: true,
          eliminatedAt: now,
          eliminatedInPhase: phase,
          lifeStatus: "red" as LifeStatus,
        }
      : p,
  );
}

/**
 * Marque le ou les finalistes (= survivants quand on passe au face-à-face).
 * Idempotent : si déjà marqué, retourne le même array.
 */
export function markFinalists(players: DcPlayer[]): DcPlayer[] {
  return players.map((p) =>
    p.isEliminated || p.isFinalist ? p : { ...p, isFinalist: true },
  );
}

/**
 * Tire 2 catégories aléatoires distinctes dans la liste fournie.
 * Si moins de 2 catégories disponibles, retourne ce qu'il y a.
 */
export function pickDuelThemes(
  categories: DuelTheme[],
  rng: () => number = Math.random,
): DuelTheme[] {
  if (categories.length === 0) return [];
  if (categories.length === 1) return [categories[0]!];
  const shuffled = [...categories];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  return shuffled.slice(0, 2);
}

/**
 * Construit le classement final pour le podium :
 *  - Rang 1 = vainqueur (seul non-éliminé OU vainqueur du face-à-face)
 *  - Rangs suivants : ordre d'élimination INVERSE (le dernier éliminé
 *    finit 2e, le premier finit dernier)
 *
 * winnerToken : explicite si on connaît le gagnant (sortie du face-à-face),
 * sinon on prend le seul non-éliminé.
 */
export function buildFinalRanking(
  players: DcPlayer[],
  winnerToken: string | null,
): FinalRanking[] {
  // 1. Détermine le gagnant
  let winner: DcPlayer | undefined;
  if (winnerToken) {
    winner = players.find((p) => p.token === winnerToken);
  } else {
    winner = players.find((p) => !p.isEliminated);
  }

  const sortedLosers = [...players]
    .filter((p) => p.token !== winner?.token)
    .sort((a, b) => {
      // Dernier éliminé en premier (eliminatedAt le plus grand)
      const ta = a.eliminatedAt ?? 0;
      const tb = b.eliminatedAt ?? 0;
      return tb - ta;
    });

  const ranking: FinalRanking[] = [];
  if (winner) {
    ranking.push({
      token: winner.token,
      pseudo: winner.pseudo,
      rank: 1,
    });
  }
  sortedLosers.forEach((p, i) => {
    const rank = (i + 2) as 1 | 2 | 3 | 4;
    if (rank <= 4) {
      ranking.push({ token: p.token, pseudo: p.pseudo, rank });
    }
  });
  return ranking;
}

/**
 * Type guard pour distinguer une CpcQuestion d'une QuizzQuestion à
 * partir de la présence de `propositions` ou `choices`.
 */
export function isCpcQuestion(
  q: QuizzQuestion | CpcQuestion | null,
): q is CpcQuestion {
  return !!q && "propositions" in q;
}

export function isQuizzQuestion(
  q: QuizzQuestion | CpcQuestion | null,
): q is QuizzQuestion {
  return !!q && "choices" in q;
}

export function isTvDouzeCoupsState(x: unknown): x is TvDouzeCoupsState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.phase === "string" &&
    Array.isArray(o.players) &&
    Array.isArray(o.turnOrder) &&
    typeof o.currentPlayerIdx === "number"
  );
}
