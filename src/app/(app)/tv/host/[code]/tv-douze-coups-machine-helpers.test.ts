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
  applyDuelAnswer,
  applyDuelCandidateSelection,
  applyDuelThemeSelection,
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

  it("en Coup par Coup, utilise intrusIdx comme bonne réponse", () => {
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
    expect(r.isCorrect).toBe(true);
    expect(r.correctIdx).toBe(4);
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
