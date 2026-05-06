import { describe, expect, it } from "vitest";
import {
  botWillAnswerCorrectly,
  isBotToken,
  pickBotAnswerIdx,
  pickBotCpcNextIdx,
  pickBotDelayMs,
  pickBotDuelCandidate,
  pickBotDuelTheme,
} from "./bot-behavior";

/** RNG déterministe : retourne les valeurs fournies dans l'ordre. */
function seededRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i++;
    return v;
  };
}

describe("isBotToken", () => {
  it("détecte les tokens bots et humains", () => {
    expect(isBotToken("bot:abc-def")).toBe(true);
    expect(isBotToken("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isBotToken("")).toBe(false);
  });
});

describe("botWillAnswerCorrectly", () => {
  it("skill=100 → toujours bonne réponse", () => {
    const rng = seededRng([0.99, 0.5, 0.0]);
    expect(botWillAnswerCorrectly(100, rng)).toBe(true);
    expect(botWillAnswerCorrectly(100, rng)).toBe(true);
    expect(botWillAnswerCorrectly(100, rng)).toBe(true);
  });

  it("skill=0 → jamais bonne réponse", () => {
    const rng = seededRng([0.0, 0.5, 0.99]);
    expect(botWillAnswerCorrectly(0, rng)).toBe(false);
    expect(botWillAnswerCorrectly(0, rng)).toBe(false);
    expect(botWillAnswerCorrectly(0, rng)).toBe(false);
  });

  it("skill=70 : rng=0.5 (50%) → correct ; rng=0.8 (80%) → faux", () => {
    expect(botWillAnswerCorrectly(70, () => 0.5)).toBe(true);
    expect(botWillAnswerCorrectly(70, () => 0.8)).toBe(false);
  });

  it("clamp skill out-of-range", () => {
    expect(botWillAnswerCorrectly(-50, () => 0.0)).toBe(false);
    expect(botWillAnswerCorrectly(150, () => 0.99)).toBe(true);
  });
});

describe("pickBotAnswerIdx", () => {
  it("skill=100 → renvoie toujours correctIdx", () => {
    expect(pickBotAnswerIdx(4, 2, 100, () => 0.5)).toBe(2);
    expect(pickBotAnswerIdx(4, 0, 100, () => 0.99)).toBe(0);
  });

  it("skill=0 → renvoie un idx ≠ correctIdx", () => {
    // rng pour la décision = 0.5 (skill=0 donc toujours faux)
    // rng pour le choix wrong = 0.0 → pickerne premier wrong
    const rng = seededRng([0.5, 0.0]);
    const idx = pickBotAnswerIdx(4, 2, 0, rng);
    expect(idx).not.toBe(2);
    expect([0, 1, 3]).toContain(idx);
  });

  it("skill=0 sur question à 2 choix → renvoie le mauvais", () => {
    const rng = seededRng([0.9, 0.0]);
    expect(pickBotAnswerIdx(2, 0, 0, rng)).toBe(1);
    const rng2 = seededRng([0.9, 0.0]);
    expect(pickBotAnswerIdx(2, 1, 0, rng2)).toBe(0);
  });

  it("totalChoices=0 → renvoie 0 (fallback)", () => {
    expect(pickBotAnswerIdx(0, 0, 100, () => 0.5)).toBe(0);
  });
});

describe("pickBotDuelCandidate", () => {
  it("renvoie un candidat vivant ≠ challenger", () => {
    const players = [
      { token: "challenger", isEliminated: false },
      { token: "alice", isEliminated: false },
      { token: "bob", isEliminated: false },
      { token: "carol", isEliminated: true },
    ];
    const rng = seededRng([0.0]);
    const pick = pickBotDuelCandidate(players, "challenger", rng);
    expect(["alice", "bob"]).toContain(pick);
  });

  it("ignore les éliminés", () => {
    const players = [
      { token: "challenger", isEliminated: false },
      { token: "alice", isEliminated: true },
      { token: "bob", isEliminated: false },
    ];
    expect(pickBotDuelCandidate(players, "challenger", () => 0.99)).toBe("bob");
  });

  it("renvoie null si aucun candidat éligible", () => {
    const players = [
      { token: "challenger", isEliminated: false },
      { token: "alice", isEliminated: true },
    ];
    expect(pickBotDuelCandidate(players, "challenger", () => 0.5)).toBeNull();
  });
});

describe("pickBotDuelTheme", () => {
  it("choisit un id de thème dans la liste", () => {
    const themes = [{ id: 1 }, { id: 2 }];
    expect([1, 2]).toContain(pickBotDuelTheme(themes, () => 0.0));
    expect([1, 2]).toContain(pickBotDuelTheme(themes, () => 0.99));
  });

  it("renvoie null si pas de thème", () => {
    expect(pickBotDuelTheme([], () => 0.5)).toBeNull();
  });
});

describe("pickBotDelayMs", () => {
  it("borne entre minMs et maxMs", () => {
    expect(pickBotDelayMs(() => 0.0, 1200, 3000)).toBe(1200);
    expect(pickBotDelayMs(() => 0.999, 1200, 3000)).toBeGreaterThanOrEqual(2998);
    expect(pickBotDelayMs(() => 0.5, 1200, 3000)).toBe(2100);
  });

  it("gère minMs > maxMs (clamp)", () => {
    // max devient égal à min
    expect(pickBotDelayMs(() => 0.5, 3000, 1200)).toBe(3000);
  });
});

// Vague V (#5) — Bot CPC continu : choisit clic par clic
describe("pickBotCpcNextIdx", () => {
  it("skill=100 + foundIndices vide → choisit une bonne (jamais l'intrus)", () => {
    const idx = pickBotCpcNextIdx(7, 4, [], 100, () => 0.5);
    expect(idx).not.toBe(4); // pas l'intrus
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("skill=0 → choisit l'intrus", () => {
    const idx = pickBotCpcNextIdx(7, 4, [], 0, () => 0.5);
    expect(idx).toBe(4);
  });

  it("retourne null si toutes les bonnes sont trouvées", () => {
    // 7 props, intrus idx 4, donc bonnes = [0,1,2,3,5,6]. Si toutes trouvées → null
    const idx = pickBotCpcNextIdx(7, 4, [0, 1, 2, 3, 5, 6], 100, () => 0.5);
    expect(idx).toBeNull();
  });

  it("ne retourne jamais un idx déjà trouvé (skill=100)", () => {
    const found = [0, 1, 2];
    for (let i = 0; i < 20; i++) {
      const idx = pickBotCpcNextIdx(7, 4, found, 100, () => i / 20);
      expect(found.includes(idx!)).toBe(false);
      expect(idx).not.toBe(4); // jamais l'intrus avec skill=100
    }
  });
});
