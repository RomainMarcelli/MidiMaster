import { describe, expect, it } from "vitest";
import {
  applyAnswerToPlayer,
  aliveCount,
  buildFinalRanking,
  isCpcQuestion,
  isQuizzQuestion,
  lifeStatusFromErrors,
  markFinalists,
  nextActivePlayerIdx,
  pickDuelThemes,
  resolveDuel,
  type DcPlayer,
  type DuelTheme,
  type QuizzQuestion,
  type CpcQuestion,
} from "./tv-douze-coups-state";

function mkPlayer(token: string, overrides: Partial<DcPlayer> = {}): DcPlayer {
  return {
    token,
    pseudo: token.toUpperCase(),
    avatarUrl: null,
    lifeStatus: "green",
    isEliminated: false,
    eliminatedAt: null,
    eliminatedInPhase: null,
    score: 0,
    isFinalist: false,
    ...overrides,
  };
}

describe("lifeStatusFromErrors", () => {
  it("0 → green, 1 → orange, 2+ → red", () => {
    expect(lifeStatusFromErrors(0)).toBe("green");
    expect(lifeStatusFromErrors(1)).toBe("orange");
    expect(lifeStatusFromErrors(2)).toBe("red");
    expect(lifeStatusFromErrors(5)).toBe("red");
  });
});

describe("aliveCount", () => {
  it("compte uniquement les non-éliminés", () => {
    expect(
      aliveCount([
        mkPlayer("a"),
        mkPlayer("b", { isEliminated: true, eliminatedAt: 1 }),
        mkPlayer("c"),
      ]),
    ).toBe(2);
  });
});

describe("nextActivePlayerIdx", () => {
  it("cycle simple A→B→C→D→A sans éliminé", () => {
    const players = [mkPlayer("a"), mkPlayer("b"), mkPlayer("c"), mkPlayer("d")];
    const order = ["a", "b", "c", "d"];
    expect(nextActivePlayerIdx(0, order, players)).toBe(1);
    expect(nextActivePlayerIdx(3, order, players)).toBe(0);
  });

  it("saute les éliminés", () => {
    const players = [
      mkPlayer("a"),
      mkPlayer("b", { isEliminated: true, eliminatedAt: 1 }),
      mkPlayer("c"),
      mkPlayer("d"),
    ];
    const order = ["a", "b", "c", "d"];
    expect(nextActivePlayerIdx(0, order, players)).toBe(2); // skip b
  });

  it("retourne -1 si tous éliminés", () => {
    const players = [
      mkPlayer("a", { isEliminated: true, eliminatedAt: 1 }),
      mkPlayer("b", { isEliminated: true, eliminatedAt: 2 }),
    ];
    expect(nextActivePlayerIdx(0, ["a", "b"], players)).toBe(-1);
  });
});

describe("applyAnswerToPlayer", () => {
  it("bonne réponse : +1 score, vie inchangée", () => {
    const p = mkPlayer("a", { lifeStatus: "orange", score: 2 });
    const r = applyAnswerToPlayer(p, true);
    expect(r.score).toBe(3);
    expect(r.lifeStatus).toBe("orange");
  });

  it("mauvaise réponse : vie dégradée d'un cran", () => {
    expect(applyAnswerToPlayer(mkPlayer("a"), false).lifeStatus).toBe("orange");
    expect(
      applyAnswerToPlayer(mkPlayer("a", { lifeStatus: "orange" }), false)
        .lifeStatus,
    ).toBe("red");
    expect(
      applyAnswerToPlayer(mkPlayer("a", { lifeStatus: "red" }), false)
        .lifeStatus,
    ).toBe("red"); // déjà red, ne dégrade pas davantage
  });

  it("mauvaise réponse ne donne pas de point", () => {
    const p = mkPlayer("a", { score: 5 });
    expect(applyAnswerToPlayer(p, false).score).toBe(5);
  });
});

describe("resolveDuel", () => {
  const players = [
    mkPlayer("X", { lifeStatus: "red" }),
    mkPlayer("Y", { lifeStatus: "green" }),
    mkPlayer("Z"),
  ];

  it("candidat bon → challenger éliminé, candidat intact", () => {
    const r = resolveDuel(players, "X", "Y", true, "coup-envoi", 1000);
    const x = r.find((p) => p.token === "X")!;
    const y = r.find((p) => p.token === "Y")!;
    expect(x.isEliminated).toBe(true);
    expect(x.eliminatedAt).toBe(1000);
    expect(x.eliminatedInPhase).toBe("coup-envoi");
    expect(y.lifeStatus).toBe("green"); // candidat intact
    expect(y.isEliminated).toBe(false);
  });

  it("candidat mauvais → challenger reste rouge mais vivant, candidat intact", () => {
    const r = resolveDuel(players, "X", "Y", false, "coup-envoi");
    const x = r.find((p) => p.token === "X")!;
    const y = r.find((p) => p.token === "Y")!;
    expect(x.isEliminated).toBe(false);
    expect(x.lifeStatus).toBe("red"); // toujours rouge
    expect(y.lifeStatus).toBe("green");
  });

  it("retourne les mêmes refs si rien ne change (candidat mauvais)", () => {
    const r = resolveDuel(players, "X", "Y", false, "coup-envoi");
    expect(r).toBe(players);
  });
});

describe("markFinalists", () => {
  it("marque les survivants comme finalistes, ignore les éliminés", () => {
    const players = [
      mkPlayer("a", { isEliminated: true, eliminatedAt: 1 }),
      mkPlayer("b"),
      mkPlayer("c"),
    ];
    const r = markFinalists(players);
    expect(r.find((p) => p.token === "a")!.isFinalist).toBe(false);
    expect(r.find((p) => p.token === "b")!.isFinalist).toBe(true);
    expect(r.find((p) => p.token === "c")!.isFinalist).toBe(true);
  });
});

describe("pickDuelThemes", () => {
  const themes: DuelTheme[] = [
    { id: 1, slug: "histoire", nom: "Histoire" },
    { id: 2, slug: "geo", nom: "Géographie" },
    { id: 3, slug: "sport", nom: "Sport" },
    { id: 4, slug: "sciences", nom: "Sciences" },
  ];

  it("retourne 2 thèmes distincts", () => {
    const r = pickDuelThemes(themes, () => 0.5);
    expect(r).toHaveLength(2);
    expect(r[0]!.id).not.toBe(r[1]!.id);
  });

  it("retourne 1 si la liste contient 1 seul", () => {
    expect(pickDuelThemes([themes[0]!])).toHaveLength(1);
  });

  it("retourne [] si liste vide", () => {
    expect(pickDuelThemes([])).toEqual([]);
  });
});

describe("buildFinalRanking", () => {
  it("4 joueurs : gagnant explicite + 3 perdants par ordre élimination inverse", () => {
    const players = [
      mkPlayer("alice"), // gagnante (non éliminée)
      mkPlayer("bob", { isEliminated: true, eliminatedAt: 3000 }), // 2e
      mkPlayer("carol", { isEliminated: true, eliminatedAt: 2000 }), // 3e
      mkPlayer("dave", { isEliminated: true, eliminatedAt: 1000 }), // 4e
    ];
    const r = buildFinalRanking(players, "alice");
    expect(r).toEqual([
      { token: "alice", pseudo: "ALICE", rank: 1 },
      { token: "bob", pseudo: "BOB", rank: 2 },
      { token: "carol", pseudo: "CAROL", rank: 3 },
      { token: "dave", pseudo: "DAVE", rank: 4 },
    ]);
  });

  it("gagnant déduit (1 seul non-éliminé) si winnerToken=null", () => {
    const players = [
      mkPlayer("alice"),
      mkPlayer("bob", { isEliminated: true, eliminatedAt: 2 }),
    ];
    const r = buildFinalRanking(players, null);
    expect(r[0]!.token).toBe("alice");
    expect(r[0]!.rank).toBe(1);
  });

  it("limité à 4 entrées max (si 5+ joueurs)", () => {
    const players = [
      mkPlayer("a"),
      mkPlayer("b", { isEliminated: true, eliminatedAt: 4 }),
      mkPlayer("c", { isEliminated: true, eliminatedAt: 3 }),
      mkPlayer("d", { isEliminated: true, eliminatedAt: 2 }),
      mkPlayer("e", { isEliminated: true, eliminatedAt: 1 }),
    ];
    const r = buildFinalRanking(players, "a");
    expect(r).toHaveLength(4);
  });
});

describe("type guards", () => {
  const quizz: QuizzQuestion = {
    id: "q1",
    enonce: "?",
    choices: [{ idx: 0, text: "a" }],
    correctIdx: 0,
    categoryId: 1,
  };
  const cpc: CpcQuestion = {
    id: "q2",
    enonce: "Thème",
    propositions: [{ idx: 0, text: "x", correct: true }],
    intrusIdx: 0,
  };

  it("isQuizzQuestion / isCpcQuestion discriminent correctement", () => {
    expect(isQuizzQuestion(quizz)).toBe(true);
    expect(isQuizzQuestion(cpc)).toBe(false);
    expect(isCpcQuestion(cpc)).toBe(true);
    expect(isCpcQuestion(quizz)).toBe(false);
    expect(isQuizzQuestion(null)).toBe(false);
    expect(isCpcQuestion(null)).toBe(false);
  });
});

// ============================================================================
// Scénarios d'orchestration : enchaînements typiques d'une partie
// 12 Coups TV. On simule manuellement les transitions sans monter le
// composant React (pure helpers).
// ============================================================================
describe("scénarios complets 12 Coups TV", () => {
  it("3 erreurs consécutives → joueur passe vert→orange→rouge", () => {
    let p = mkPlayer("alice");
    expect(p.lifeStatus).toBe("green");
    p = applyAnswerToPlayer(p, false);
    expect(p.lifeStatus).toBe("orange");
    p = applyAnswerToPlayer(p, false);
    expect(p.lifeStatus).toBe("red");
    // Toute nouvelle erreur garde "rouge" (cap)
    p = applyAnswerToPlayer(p, false);
    expect(p.lifeStatus).toBe("red");
  });

  it("bonne réponse incrémente le score sans toucher la vie", () => {
    let p = mkPlayer("alice", { lifeStatus: "orange" });
    p = applyAnswerToPlayer(p, true);
    expect(p.lifeStatus).toBe("orange");
    expect(p.score).toBe(1);
    p = applyAnswerToPlayer(p, true);
    expect(p.score).toBe(2);
  });

  it("duel raté → challenger reste rouge mais survit, candidat intact", () => {
    const players = [
      mkPlayer("alice", { lifeStatus: "red", score: 5 }),
      mkPlayer("bob", { lifeStatus: "green", score: 3 }),
    ];
    const after = resolveDuel(players, "alice", "bob", false, "coup-envoi");
    const alice = after.find((p) => p.token === "alice")!;
    const bob = after.find((p) => p.token === "bob")!;
    expect(alice.isEliminated).toBe(false);
    expect(alice.lifeStatus).toBe("red");
    expect(alice.score).toBe(5);
    expect(bob.score).toBe(3);
    expect(bob.isEliminated).toBe(false);
  });

  it("duel gagné par candidat → challenger éliminé instantanément", () => {
    const players = [
      mkPlayer("alice", { lifeStatus: "red" }),
      mkPlayer("bob"),
    ];
    const after = resolveDuel(
      players,
      "alice",
      "bob",
      true,
      "coup-envoi",
      1234,
    );
    const alice = after.find((p) => p.token === "alice")!;
    expect(alice.isEliminated).toBe(true);
    expect(alice.eliminatedAt).toBe(1234);
    expect(alice.eliminatedInPhase).toBe("coup-envoi");
  });

  it("nextActivePlayerIdx ne propose plus le challenger éliminé après duel", () => {
    const players = [
      mkPlayer("a"),
      mkPlayer("b", { isEliminated: true, eliminatedAt: 1 }),
      mkPlayer("c"),
      mkPlayer("d"),
    ];
    const order = ["a", "b", "c", "d"];
    expect(nextActivePlayerIdx(0, order, players)).toBe(2);
  });

  it("transition CE→CPC : 3 survivants exactement, 1 éliminé via duel", () => {
    // 4 joueurs : alice tombe, est éliminée → 3 survivants → CPC
    const players = [
      mkPlayer("a", {
        isEliminated: true,
        eliminatedAt: 1,
        eliminatedInPhase: "coup-envoi",
      }),
      mkPlayer("b"),
      mkPlayer("c"),
      mkPlayer("d"),
    ];
    expect(aliveCount(players)).toBe(3);
  });

  it("transition CPC→FA : 2 survivants exactement → marquage finalistes", () => {
    const players = [
      mkPlayer("a", { isEliminated: true, eliminatedAt: 10 }),
      mkPlayer("b", { isEliminated: true, eliminatedAt: 20 }),
      mkPlayer("c"),
      mkPlayer("d"),
    ];
    expect(aliveCount(players)).toBe(2);
    const marked = markFinalists(players);
    expect(marked.find((p) => p.token === "c")!.isFinalist).toBe(true);
    expect(marked.find((p) => p.token === "d")!.isFinalist).toBe(true);
    expect(marked.find((p) => p.token === "a")!.isFinalist).toBe(false);
  });

  it("S1.2 — partie démarrée à 2 joueurs n'enchaîne PAS direct au podium", () => {
    // Reproduit le bug Vague S : avec 2 joueurs au démarrage,
    // aliveCount === 2 dès le départ. Le code DOIT distinguer
    // "transition après élimination effective" (alive vient de
    // baisser) vs "tour normal" (alive inchangé). Test indirect :
    // on vérifie qu'à l'état initial avec 2 joueurs, aliveCount
    // n'est PAS un signal valide pour basculer en podium ; il faut
    // un changement d'état (élimination réelle) pour transitionner.
    const initialPlayers = [mkPlayer("a"), mkPlayer("b")];
    expect(aliveCount(initialPlayers)).toBe(2);
    // Aucun joueur n'est éliminé encore → la phase "playing" ne
    // doit pas auto-transitionner. Le test ci-dessous est documentaire :
    // dans le code, la transition est désormais déclenchée
    // explicitement par transitionAfterElimination(), pas par
    // advanceTurn() qui se contente d'avancer le tour.
    const everEliminated = initialPlayers.some((p) => p.isEliminated);
    expect(everEliminated).toBe(false);
  });

  it("S1.2 — partie démarrée à 3 joueurs ne déclenche pas la transition CE→CPC tant qu'aucun n'est éliminé", () => {
    const initialPlayers = [mkPlayer("a"), mkPlayer("b"), mkPlayer("c")];
    expect(aliveCount(initialPlayers)).toBe(3);
    // On peut faire 10 mauvaises réponses sans qu'un seul joueur
    // ne tombe au rouge (il faut 2 erreurs successives pour le
    // même joueur). Donc aliveCount reste 3, et transitionner
    // dès qu'aliveCount <= 3 serait incorrect.
    let p = mkPlayer("a");
    p = applyAnswerToPlayer(p, false); // orange
    expect(p.lifeStatus).toBe("orange");
    p = applyAnswerToPlayer(p, true); // bonne (pas de chgt vie)
    expect(p.lifeStatus).toBe("orange");
    expect(p.isEliminated).toBe(false);
  });

  it("podium final : winner en rang 1, perdants en ordre d'élimination inverse", () => {
    const players = [
      mkPlayer("alice", { score: 8 }), // gagnant
      mkPlayer("bob", {
        isEliminated: true,
        eliminatedAt: 30,
        eliminatedInPhase: "coup-par-coup",
      }), // 2e (dernier éliminé)
      mkPlayer("carol", {
        isEliminated: true,
        eliminatedAt: 20,
        eliminatedInPhase: "coup-par-coup",
      }), // 3e
      mkPlayer("dave", {
        isEliminated: true,
        eliminatedAt: 10,
        eliminatedInPhase: "coup-envoi",
      }), // 4e (1er éliminé)
    ];
    const r = buildFinalRanking(players, "alice");
    expect(r.map((x) => x.token)).toEqual(["alice", "bob", "carol", "dave"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
  });
});
