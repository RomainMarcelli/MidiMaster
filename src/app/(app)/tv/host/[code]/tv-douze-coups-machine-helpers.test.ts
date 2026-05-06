import { describe, expect, it } from "vitest";
import type {
  CpcQuestion,
  DcPlayer,
  QuizzQuestion,
  TvDouzeCoupsState,
} from "@/lib/realtime/tv-douze-coups-state";
import {
  advanceTurn,
  applyAnswer,
  applyConvertToBot,
  applyCpcAnswer,
  applyDuelAnswer,
  applyDuelCandidateSelection,
  applyDuelThemeSelection,
  applyEliminateLeftPlayer,
  applyPlayerLeftPause,
  applyResume,
  endEliminationAnimation,
  transitionAfterElimination,
} from "./tv-douze-coups-machine-helpers";

// ============================================================================
// Fixtures
// ============================================================================

function makePlayer(overrides: Partial<DcPlayer> = {}): DcPlayer {
  return {
    token: "p1",
    pseudo: "Alice",
    avatarUrl: null,
    lifeStatus: "green",
    isEliminated: false,
    eliminatedAt: null,
    eliminatedInPhase: null,
    score: 0,
    isFinalist: false,
    isBot: false,
    botSkill: 70,
    ...overrides,
  };
}

function makeQuizz(overrides: Partial<QuizzQuestion> = {}): QuizzQuestion {
  return {
    id: "q1",
    enonce: "Capitale de la France ?",
    format: null,
    choices: [
      { idx: 0, text: "Paris" },
      { idx: 1, text: "Lyon" },
    ],
    correctIdx: 0,
    explication: null,
    categoryId: null,
    ...overrides,
  };
}

function makeCpc(overrides: Partial<CpcQuestion> = {}): CpcQuestion {
  return {
    id: "cpc1",
    enonce: "Pays méditerranéens",
    propositions: [
      { idx: 0, text: "Italie", correct: true },
      { idx: 1, text: "Espagne", correct: true },
      { idx: 2, text: "France", correct: true },
      { idx: 3, text: "Grèce", correct: true },
      { idx: 4, text: "Allemagne", correct: false },
      { idx: 5, text: "Maroc", correct: true },
      { idx: 6, text: "Tunisie", correct: true },
    ],
    intrusIdx: 4,
    explication: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<TvDouzeCoupsState> = {}): TvDouzeCoupsState {
  return {
    phase: "coup-envoi-playing",
    players: [
      makePlayer({ token: "p1", pseudo: "Alice" }),
      makePlayer({ token: "p2", pseudo: "Bob" }),
      makePlayer({ token: "p3", pseudo: "Carla" }),
      makePlayer({ token: "p4", pseudo: "Dimitri" }),
    ],
    turnOrder: ["p1", "p2", "p3", "p4"],
    currentPlayerIdx: 0,
    currentQuestion: makeQuizz(),
    currentDuel: null,
    eliminationAnimation: null,
    questionPool: {
      coupEnvoi: [makeQuizz({ id: "q2" }), makeQuizz({ id: "q3" })],
      coupParCoup: [makeCpc({ id: "cpc2" })],
      duels: [makeQuizz({ id: "qd1", correctIdx: 1 })],
    },
    faceAFacePresenterToken: null,
    presenterDesignationMode: "random",
    finalRanking: null,
    ...overrides,
  };
}

// ============================================================================
// advanceTurn
// ============================================================================

describe("advanceTurn", () => {
  it("avance au joueur suivant en Coup d'Envoi et tire la prochaine question", () => {
    const next = advanceTurn(makeState());
    expect(next.currentPlayerIdx).toBe(1);
    expect(next.currentQuestion?.id).toBe("q2");
    expect(next.questionPool.coupEnvoi).toHaveLength(1);
  });

  it("saute les joueurs éliminés", () => {
    const s = makeState({
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2", isEliminated: true }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
      ],
    });
    const next = advanceTurn(s);
    expect(next.currentPlayerIdx).toBe(2); // saute p2
  });

  it("en Coup par Coup, tire dans le pool CPC", () => {
    const s = makeState({
      phase: "coup-par-coup-playing",
      currentQuestion: makeCpc(),
    });
    const next = advanceTurn(s);
    expect(next.currentQuestion?.id).toBe("cpc2");
    expect(next.questionPool.coupParCoup).toHaveLength(0);
  });

  // Vague V (#1.1) — Tour de table complet 4 joueurs : 0→1→2→3→0.
  // Confirme que `nextActivePlayerIdx` ne saute aucun index quand tous sont
  // vivants (le bug "joueurs 1 et 3 only" observé en prod ne vient PAS de
  // l'algo pure — confirmé par ce test).
  it("4 joueurs vivants : tour complet 0→1→2→3→0 (sans saut)", () => {
    let s = makeState({
      questionPool: {
        coupEnvoi: [
          makeQuizz({ id: "q2" }),
          makeQuizz({ id: "q3" }),
          makeQuizz({ id: "q4" }),
          makeQuizz({ id: "q5" }),
        ],
        coupParCoup: [],
        duels: [],
      },
    });
    s = advanceTurn(s);
    expect(s.currentPlayerIdx).toBe(1);
    s = advanceTurn(s);
    expect(s.currentPlayerIdx).toBe(2);
    s = advanceTurn(s);
    expect(s.currentPlayerIdx).toBe(3);
    s = advanceTurn(s);
    expect(s.currentPlayerIdx).toBe(0);
  });

  it("reset lastAnswerKey à null après advanceTurn", () => {
    const s = makeState({ lastAnswerKey: "q1:p1:0" });
    const next = advanceTurn(s);
    expect(next.lastAnswerKey).toBeNull();
  });
});

// ============================================================================
// transitionAfterElimination
// ============================================================================

describe("transitionAfterElimination", () => {
  it("retourne null si on est en Coup d'Envoi avec encore 4 vivants", () => {
    expect(transitionAfterElimination(makeState())).toBeNull();
  });

  it("bascule CE → CPC quand il reste 3 vivants après élim", () => {
    const s = makeState({
      phase: "coup-envoi-elimination",
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4", isEliminated: true }),
      ],
    });
    const next = transitionAfterElimination(s);
    expect(next?.phase).toBe("coup-par-coup-playing");
    expect(next?.turnOrder).toEqual(["p1", "p2", "p3"]);
    expect(next?.currentPlayerIdx).toBe(0);
  });

  // Vague V (#5) — Reset des vies au passage CE → CPC : un joueur orange
  // à la fin du CE redémarre à "vert" en CPC.
  it("CE → CPC : reset les vies des survivants à 'green'", () => {
    const s = makeState({
      phase: "coup-envoi-elimination",
      players: [
        makePlayer({ token: "p1", lifeStatus: "green" }),
        makePlayer({ token: "p2", lifeStatus: "orange" }),
        makePlayer({ token: "p3", lifeStatus: "red" }),
        makePlayer({ token: "p4", isEliminated: true, lifeStatus: "red" }),
      ],
    });
    const next = transitionAfterElimination(s);
    expect(next?.phase).toBe("coup-par-coup-playing");
    const p1 = next?.players.find((p) => p.token === "p1");
    const p2 = next?.players.find((p) => p.token === "p2");
    const p3 = next?.players.find((p) => p.token === "p3");
    const p4 = next?.players.find((p) => p.token === "p4");
    expect(p1?.lifeStatus).toBe("green");
    expect(p2?.lifeStatus).toBe("green"); // reset depuis orange
    expect(p3?.lifeStatus).toBe("green"); // reset depuis red
    expect(p4?.lifeStatus).toBe("red"); // éliminé : pas reset
    expect(p4?.isEliminated).toBe(true);
  });

  it("bascule CPC → FA quand il reste 2 vivants après élim", () => {
    const s = makeState({
      phase: "coup-par-coup-elimination",
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3", isEliminated: true }),
        makePlayer({ token: "p4", isEliminated: true }),
      ],
    });
    const next = transitionAfterElimination(s);
    expect(next?.phase).toBe("face-a-face-vote");
    // Les survivants sont marqués finalistes
    const p1After = next?.players.find((p) => p.token === "p1");
    expect(p1After?.isFinalist).toBe(true);
  });

  it("retourne null en CPC si encore 3+ vivants", () => {
    const s = makeState({
      phase: "coup-par-coup-playing",
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
      ],
    });
    expect(transitionAfterElimination(s)).toBeNull();
  });
});

// ============================================================================
// applyAnswer
// ============================================================================

describe("applyAnswer", () => {
  it("rejette une réponse d'un joueur dont ce n'est pas le tour", () => {
    const r = applyAnswer(
      makeState(),
      { questionId: "q1", chosenIdx: 0, playerToken: "p2" },
      "ce",
    );
    expect(r).toEqual({ kind: "rejected", reason: "wrong-token" });
  });

  it("rejette une réponse pour la mauvaise question", () => {
    const r = applyAnswer(
      makeState(),
      { questionId: "WRONG", chosenIdx: 0, playerToken: "p1" },
      "ce",
    );
    expect(r).toEqual({ kind: "rejected", reason: "wrong-question" });
  });

  it("accepte une bonne réponse, ne change pas la vie, +1 score", () => {
    const r = applyAnswer(
      makeState(),
      { questionId: "q1", chosenIdx: 0, playerToken: "p1" },
      "ce",
    );
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.isCorrect).toBe(true);
    expect(r.triggersDuel).toBe(false);
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("green");
    expect(p1?.score).toBe(1);
  });

  it("dégrade la vie green → orange sur mauvaise réponse", () => {
    const r = applyAnswer(
      makeState(),
      { questionId: "q1", chosenIdx: 1, playerToken: "p1" },
      "ce",
    );
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.triggersDuel).toBe(false);
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("orange");
  });

  it("déclenche un duel quand vie passe orange → red", () => {
    const s = makeState({
      players: [
        makePlayer({ token: "p1", lifeStatus: "orange" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
      ],
    });
    const r = applyAnswer(
      s,
      { questionId: "q1", chosenIdx: 1, playerToken: "p1" },
      "ce",
    );
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.triggersDuel).toBe(true);
    expect(r.next.phase).toBe("coup-envoi-duel-select");
    expect(r.next.currentDuel?.challengerToken).toBe("p1");
    expect(r.challengerPseudo).toBe("Alice");
  });

  // Vague V (#1.3) — Sémantique CPC : cliquer l'intrus = MAUVAISE réponse.
  // Avant V, le code calculait isCorrect = chosenIdx === intrusIdx → INVERSÉ.
  it("CPC : cliquer l'intrus est une mauvaise réponse (vie -1)", () => {
    const s = makeState({
      phase: "coup-par-coup-playing",
      currentQuestion: makeCpc(),
    });
    const r = applyAnswer(
      s,
      { questionId: "cpc1", chosenIdx: 4, playerToken: "p1" },
      "cpc",
    );
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.isCorrect).toBe(false);
    expect(r.correctIdx).toBe(4); // intrusIdx, pour broadcast `cpc:question-result`
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("orange");
  });

  it("CPC : cliquer une proposition liée est une bonne réponse", () => {
    const s = makeState({
      phase: "coup-par-coup-playing",
      currentQuestion: makeCpc(),
    });
    const r = applyAnswer(
      s,
      { questionId: "cpc1", chosenIdx: 0, playerToken: "p1" }, // Italie (correct=true)
      "cpc",
    );
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.isCorrect).toBe(true);
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("green");
    expect(p1?.score).toBe(1);
  });

  // Vague V (#1.1, #1.2) — Idempotence : un event Realtime doublonné (cause
  // probable du saut de tour + duel précoce observé en prod) est rejeté.
  it("rejette un event identique reçu une 2e fois (idempotence)", () => {
    const s = makeState();
    const payload = { questionId: "q1", chosenIdx: 1, playerToken: "p1" };
    const r1 = applyAnswer(s, payload, "ce");
    expect(r1.kind).toBe("accepted");
    if (r1.kind !== "accepted") return;
    // 2e appel sur le state mis à jour : doit être rejeté
    const r2 = applyAnswer(r1.next, payload, "ce");
    expect(r2.kind).toBe("rejected");
    if (r2.kind !== "rejected") return;
    expect(r2.reason).toBe("duplicate");
  });

  it("idempotence : un chosenIdx différent passe (changement d'avis)", () => {
    const s = makeState();
    const r1 = applyAnswer(
      s,
      { questionId: "q1", chosenIdx: 1, playerToken: "p1" },
      "ce",
    );
    expect(r1.kind).toBe("accepted");
    if (r1.kind !== "accepted") return;
    const r2 = applyAnswer(
      r1.next,
      { questionId: "q1", chosenIdx: 0, playerToken: "p1" },
      "ce",
    );
    // Le 2e payload est différent → pas un duplicate
    expect(r2.kind).toBe("accepted");
  });
});

// ============================================================================
// Vague V (#5) — applyCpcAnswer (CPC en continu)
// ============================================================================

describe("applyCpcAnswer", () => {
  function cpcState(overrides: Partial<TvDouzeCoupsState> = {}): TvDouzeCoupsState {
    return makeState({
      phase: "coup-par-coup-playing",
      currentQuestion: makeCpc(), // intrusIdx: 4, 6 propositions correctes
      cpcFoundIndices: [],
      ...overrides,
    });
  }

  // Vague W (#1) — Mécanique tour-par-tour : un clic correct = advance turn
  // (kind "correct-advance"). Avant W, c'était "correct-continue" (continu).
  it("clic sur une bonne proposition : kind correct-advance, ajout aux foundIndices, vie inchangée", () => {
    const r = applyCpcAnswer(cpcState(), {
      questionId: "cpc1",
      chosenIdx: 0, // Italie (correct)
      playerToken: "p1",
    });
    expect(r.kind).toBe("correct-advance");
    if (r.kind !== "correct-advance") return;
    expect(r.foundIndices).toEqual([0]);
    expect(r.next.cpcFoundIndices).toEqual([0]);
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("green");
    expect(p1?.score).toBe(1);
  });

  it("clic sur l'intrus : kind wrong-intrus, vie -1, reset foundIndices", () => {
    const r = applyCpcAnswer(cpcState({ cpcFoundIndices: [0, 1] }), {
      questionId: "cpc1",
      chosenIdx: 4, // intrus
      playerToken: "p1",
    });
    expect(r.kind).toBe("wrong-intrus");
    if (r.kind !== "wrong-intrus") return;
    expect(r.intrusIdx).toBe(4);
    expect(r.triggersDuel).toBe(false);
    expect(r.next.cpcFoundIndices).toEqual([]);
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("orange");
  });

  it("clic sur l'intrus quand orange : déclenche le duel CPC", () => {
    const s = cpcState({
      players: [
        makePlayer({ token: "p1", lifeStatus: "orange" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
      ],
    });
    const r = applyCpcAnswer(s, {
      questionId: "cpc1",
      chosenIdx: 4,
      playerToken: "p1",
    });
    expect(r.kind).toBe("wrong-intrus");
    if (r.kind !== "wrong-intrus") return;
    expect(r.triggersDuel).toBe(true);
    expect(r.next.phase).toBe("coup-par-coup-duel-select");
    expect(r.next.currentDuel?.challengerToken).toBe("p1");
  });

  // Vague W (#1) — kind "all-found" remplace "series-complete" (sémantique
  // identique : toutes les 6 bonnes trouvées, reset, nouvelle question pour
  // le joueur suivant).
  it("trouver les 6 bonnes (cumulé) : kind all-found, reset foundIndices, vie inchangée", () => {
    // Déjà trouvé 5 bonnes (idx 0,1,2,3,5), reste idx 6 à trouver (idx 4 = intrus)
    const r = applyCpcAnswer(cpcState({ cpcFoundIndices: [0, 1, 2, 3, 5] }), {
      questionId: "cpc1",
      chosenIdx: 6,
      playerToken: "p1",
    });
    expect(r.kind).toBe("all-found");
    if (r.kind !== "all-found") return;
    expect(r.foundIndices).toEqual([0, 1, 2, 3, 5, 6]);
    expect(r.next.cpcFoundIndices).toEqual([]); // reset pour la prochaine question
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.lifeStatus).toBe("green");
  });

  it("rejette une 2e tentative sur la même proposition (already-found)", () => {
    const r = applyCpcAnswer(cpcState({ cpcFoundIndices: [0] }), {
      questionId: "cpc1",
      chosenIdx: 0, // déjà trouvé
      playerToken: "p1",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind !== "rejected") return;
    expect(r.reason).toBe("already-found");
  });

  it("rejette un event identique au précédent (idempotence)", () => {
    const s = cpcState();
    const payload = { questionId: "cpc1", chosenIdx: 0, playerToken: "p1" };
    const r1 = applyCpcAnswer(s, payload);
    expect(r1.kind).toBe("correct-advance");
    if (r1.kind !== "correct-advance") return;
    const r2 = applyCpcAnswer(r1.next, payload);
    expect(r2.kind).toBe("rejected");
    if (r2.kind !== "rejected") return;
    // already-found prime sur duplicate (les deux sont vrais, le flow check found en 1er car semantically clearer)
    expect(["already-found", "duplicate"]).toContain(r2.reason);
  });

  it("rejette un event d'un joueur dont ce n'est pas le tour", () => {
    const r = applyCpcAnswer(cpcState(), {
      questionId: "cpc1",
      chosenIdx: 0,
      playerToken: "p2",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind !== "rejected") return;
    expect(r.reason).toBe("wrong-token");
  });
});

// ============================================================================
// Flux duel : candidate / theme / answer
// ============================================================================

describe("applyDuelCandidateSelection", () => {
  it("bascule de duel-select à duel-theme et enregistre les thèmes", () => {
    const s = makeState({
      phase: "coup-envoi-duel-select",
      currentDuel: {
        challengerToken: "p1",
        candidateToken: null,
        proposedThemes: [],
        chosenThemeId: null,
        question: null,
      },
    });
    const themes = [
      { id: 1, slug: "histoire", nom: "Histoire" },
      { id: 2, slug: "geo", nom: "Géographie" },
    ];
    const next = applyDuelCandidateSelection(s, "p2", themes);
    expect(next.phase).toBe("coup-envoi-duel-theme");
    expect(next.currentDuel?.candidateToken).toBe("p2");
    expect(next.currentDuel?.proposedThemes).toEqual(themes);
  });

  it("est no-op si pas de duel courant", () => {
    const s = makeState({ currentDuel: null });
    const next = applyDuelCandidateSelection(s, "p2", []);
    expect(next).toEqual(s);
  });
});

describe("applyDuelThemeSelection", () => {
  it("bascule de duel-theme à duel-question et stocke la question", () => {
    const themes = [{ id: 1, slug: "h", nom: "H" }];
    const s = makeState({
      phase: "coup-envoi-duel-theme",
      currentDuel: {
        challengerToken: "p1",
        candidateToken: "p2",
        proposedThemes: themes,
        chosenThemeId: null,
        question: null,
      },
    });
    const q = makeQuizz({ id: "qd5" });
    const next = applyDuelThemeSelection(s, 1, q);
    expect(next.phase).toBe("coup-envoi-duel-question");
    expect(next.currentDuel?.chosenThemeId).toBe(1);
    expect(next.currentDuel?.question?.id).toBe("qd5");
  });

  // Vague V (#4) — Mémoire des thèmes du duel 1 pour réutilisation au duel 2.
  it("duel 1 (en CE) : mémorise proposedThemes + chosenThemeId dans duelMemory", () => {
    const themes = [
      { id: 1, slug: "histoire", nom: "Histoire" },
      { id: 2, slug: "geo", nom: "Géographie" },
    ];
    const s = makeState({
      phase: "coup-envoi-duel-theme",
      currentDuel: {
        challengerToken: "p1",
        candidateToken: "p2",
        proposedThemes: themes,
        chosenThemeId: null,
        question: null,
      },
      duelMemory: null,
    });
    const next = applyDuelThemeSelection(s, 2, makeQuizz());
    expect(next.duelMemory).not.toBeNull();
    expect(next.duelMemory?.proposedThemes).toEqual(themes);
    expect(next.duelMemory?.chosenInDuel1).toBe(2);
  });

  it("duel 2 (en CPC) : ne touche PAS duelMemory (déjà set au duel 1)", () => {
    const themes = [
      { id: 1, slug: "histoire", nom: "Histoire" },
      { id: 2, slug: "geo", nom: "Géographie" },
    ];
    const memory = { proposedThemes: themes, chosenInDuel1: 2 };
    const s = makeState({
      phase: "coup-par-coup-duel-theme",
      currentDuel: {
        challengerToken: "p1",
        candidateToken: "p2",
        proposedThemes: themes,
        chosenThemeId: null,
        question: null,
      },
      duelMemory: memory,
    });
    const next = applyDuelThemeSelection(s, 1, makeQuizz()); // candidat force à prendre Histoire
    expect(next.duelMemory).toEqual(memory); // inchangé
    expect(next.phase).toBe("coup-par-coup-duel-question");
  });
});

describe("applyDuelAnswer", () => {
  function duelState(): TvDouzeCoupsState {
    const themes = [{ id: 1, slug: "h", nom: "H" }];
    const q = makeQuizz({ id: "qd5", correctIdx: 1 });
    return makeState({
      phase: "coup-envoi-duel-question",
      players: [
        makePlayer({ token: "p1", lifeStatus: "red" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
      ],
      currentDuel: {
        challengerToken: "p1",
        candidateToken: "p2",
        proposedThemes: themes,
        chosenThemeId: 1,
        question: q,
      },
    });
  }

  it("rejette une réponse pour la mauvaise question", () => {
    const r = applyDuelAnswer(duelState(), {
      questionId: "WRONG",
      chosenIdx: 1,
      candidateToken: "p2",
    });
    expect(r).toEqual({ kind: "rejected", reason: "wrong-question" });
  });

  it("rejette une réponse d'un autre que le candidat", () => {
    const r = applyDuelAnswer(duelState(), {
      questionId: "qd5",
      chosenIdx: 1,
      candidateToken: "p3",
    });
    expect(r).toEqual({ kind: "rejected", reason: "wrong-candidate" });
  });

  it("candidat correct → challenger éliminé, phase elimination", () => {
    const r = applyDuelAnswer(
      duelState(),
      { questionId: "qd5", chosenIdx: 1, candidateToken: "p2" },
      { now: 1000, eliminationDurationMs: 4500 },
    );
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.candidateCorrect).toBe(true);
    expect(r.challengerEliminated).toBe(true);
    expect(r.eliminatedPseudo).toBe("Alice");
    expect(r.next.phase).toBe("coup-envoi-elimination");
    expect(r.next.eliminationAnimation).toEqual({
      token: "p1",
      startedAt: 1000,
      durationMs: 4500,
    });
    const p1 = r.next.players.find((p) => p.token === "p1");
    expect(p1?.isEliminated).toBe(true);
  });

  it("candidat incorrect → challenger survit, retour playing", () => {
    const r = applyDuelAnswer(duelState(), {
      questionId: "qd5",
      chosenIdx: 0,
      candidateToken: "p2",
    });
    expect(r.kind).toBe("accepted");
    if (r.kind !== "accepted") return;
    expect(r.candidateCorrect).toBe(false);
    expect(r.challengerEliminated).toBe(false);
    expect(r.next.phase).toBe("coup-envoi-playing");
    expect(r.next.currentDuel).toBeNull();
  });
});

// ============================================================================
// endEliminationAnimation
// ============================================================================

describe("endEliminationAnimation", () => {
  it("CE 4 → 3 vivants : transitionne vers CPC", () => {
    const s = makeState({
      phase: "coup-envoi-elimination",
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4", isEliminated: true }),
      ],
      eliminationAnimation: { token: "p4", startedAt: 0, durationMs: 4500 },
    });
    const r = endEliminationAnimation(s);
    expect(r.transitioned).toBe(true);
    expect(r.next.phase).toBe("coup-par-coup-playing");
    expect(r.next.eliminationAnimation).toBeNull();
  });

  it("CPC 3 → 2 vivants : transitionne vers FA", () => {
    const s = makeState({
      phase: "coup-par-coup-elimination",
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3", isEliminated: true }),
        makePlayer({ token: "p4", isEliminated: true }),
      ],
      eliminationAnimation: { token: "p4", startedAt: 0, durationMs: 4500 },
    });
    const r = endEliminationAnimation(s);
    expect(r.transitioned).toBe(true);
    expect(r.next.phase).toBe("face-a-face-vote");
  });
});

// ============================================================================
// Vague V (#7) — Helpers d'abandon de joueur (pause/eliminate/convert)
// ============================================================================

describe("applyPlayerLeftPause", () => {
  it("set les 3 champs pause", () => {
    const next = applyPlayerLeftPause(makeState(), "p2", "Bob");
    expect(next.pausedReason).toBe("player-left");
    expect(next.pausedPlayerToken).toBe("p2");
    expect(next.pausedPlayerPseudo).toBe("Bob");
  });

  it("idempotent : si déjà en pause, ne change rien (1er joueur conservé)", () => {
    const s = makeState({
      pausedReason: "player-left",
      pausedPlayerToken: "p2",
      pausedPlayerPseudo: "Bob",
    });
    const next = applyPlayerLeftPause(s, "p3", "Carla");
    expect(next.pausedPlayerToken).toBe("p2");
    expect(next.pausedPlayerPseudo).toBe("Bob");
  });
});

describe("applyResume", () => {
  it("clear les 3 champs pause", () => {
    const s = makeState({
      pausedReason: "player-left",
      pausedPlayerToken: "p2",
      pausedPlayerPseudo: "Bob",
    });
    const next = applyResume(s);
    expect(next.pausedReason).toBeNull();
    expect(next.pausedPlayerToken).toBeNull();
    expect(next.pausedPlayerPseudo).toBeNull();
  });
});

describe("applyEliminateLeftPlayer", () => {
  it("retourne null si le token n'existe pas", () => {
    expect(applyEliminateLeftPlayer(makeState(), "unknown", 1000)).toBeNull();
  });

  it("retourne null si le joueur est déjà éliminé", () => {
    const s = makeState({
      players: [
        makePlayer({ token: "p1", isEliminated: true }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
      ],
    });
    expect(applyEliminateLeftPlayer(s, "p1", 1000)).toBeNull();
  });

  it("élimine + clear pause + advance turn si c'était son tour (5 vivants → 4 vivants en CE, pas de transition)", () => {
    // 5 joueurs en CE : 5-1=4 vivants > 3, pas de transition → on teste
    // bien l'advance turn pur. Avec 4 joueurs (fixture par défaut), on
    // franchirait le seuil 4→3 = transitionAfterElimination kick in.
    const s = makeState({
      currentPlayerIdx: 0,
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
        makePlayer({ token: "p5" }),
      ],
      turnOrder: ["p1", "p2", "p3", "p4", "p5"],
      pausedReason: "player-left",
      pausedPlayerToken: "p1",
      pausedPlayerPseudo: "Alice",
    });
    const next = applyEliminateLeftPlayer(s, "p1", 1234);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.pausedReason).toBeNull();
    const p1 = next.players.find((p) => p.token === "p1");
    expect(p1?.isEliminated).toBe(true);
    expect(p1?.eliminatedAt).toBe(1234);
    expect(p1?.eliminatedInPhase).toBe("coup-envoi");
    // Tour avance vers idx 1 (p2). Pas de transition de phase (4 vivants encore).
    expect(next.phase).toBe("coup-envoi-playing");
    expect(next.currentPlayerIdx).toBe(1);
  });

  it("ne change pas le tour si l'éliminé n'est pas le joueur courant (5 vivants → 4)", () => {
    const s = makeState({
      currentPlayerIdx: 0,
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
        makePlayer({ token: "p5" }),
      ],
      turnOrder: ["p1", "p2", "p3", "p4", "p5"],
    });
    const next = applyEliminateLeftPlayer(s, "p3", 1000);
    expect(next?.currentPlayerIdx).toBe(0);
    const p3 = next?.players.find((p) => p.token === "p3");
    expect(p3?.isEliminated).toBe(true);
  });

  it("transitionne CE → CPC si l'élimination ramène à 3 vivants", () => {
    const s = makeState({
      phase: "coup-envoi-playing",
      players: [
        makePlayer({ token: "p1" }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
      ],
    });
    const next = applyEliminateLeftPlayer(s, "p4", 1000);
    expect(next?.phase).toBe("coup-par-coup-playing");
    expect(next?.turnOrder).toEqual(["p1", "p2", "p3"]);
  });
});

describe("applyConvertToBot", () => {
  it("transforme un humain en bot, garde token/pseudo, clear pause", () => {
    const s = makeState({
      players: [
        makePlayer({ token: "p1", pseudo: "Alice" }),
        makePlayer({ token: "p2", pseudo: "Bob" }),
        makePlayer({ token: "p3", pseudo: "Carla" }),
        makePlayer({ token: "p4", pseudo: "Dimitri" }),
      ],
      pausedReason: "player-left",
      pausedPlayerToken: "p2",
      pausedPlayerPseudo: "Bob",
    });
    const next = applyConvertToBot(s, "p2", 70);
    expect(next).not.toBeNull();
    if (!next) return;
    const p2 = next.players.find((p) => p.token === "p2");
    expect(p2?.isBot).toBe(true);
    expect(p2?.botSkill).toBe(70);
    expect(p2?.pseudo).toBe("Bob"); // conservé
    expect(next.pausedReason).toBeNull();
  });

  it("clamp botSkill dans [0, 100]", () => {
    const s = makeState();
    expect(applyConvertToBot(s, "p1", -50)?.players[0]?.botSkill).toBe(0);
    expect(applyConvertToBot(s, "p1", 200)?.players[0]?.botSkill).toBe(100);
  });

  it("retourne null si le joueur est éliminé", () => {
    const s = makeState({
      players: [
        makePlayer({ token: "p1", isEliminated: true }),
        makePlayer({ token: "p2" }),
        makePlayer({ token: "p3" }),
        makePlayer({ token: "p4" }),
      ],
    });
    expect(applyConvertToBot(s, "p1", 70)).toBeNull();
  });

  it("retourne null si le token n'existe pas", () => {
    expect(applyConvertToBot(makeState(), "unknown", 70)).toBeNull();
  });
});
