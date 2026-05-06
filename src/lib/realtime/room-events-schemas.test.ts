import { describe, expect, it, vi } from "vitest";
import {
  ceAnswerSubmitSchema,
  ceDuelAnswerSubmitSchema,
  ceDuelCandidateSelectedSchema,
  ceDuelThemeChosenSchema,
  cpcAnswerSubmitSchema,
  faAnswerSchema,
  faEndSchema,
  faGoSchema,
  faVoteCastSchema,
  heartbeatSchema,
  safeParseEvent,
} from "./room-events-schemas";

describe("ceAnswerSubmitSchema", () => {
  it("accepte un payload valide", () => {
    const r = ceAnswerSubmitSchema.safeParse({
      questionId: "q-uuid",
      chosenIdx: 1,
      playerToken: "12345678-aa-bb",
    });
    expect(r.success).toBe(true);
  });

  it("rejette un chosenIdx négatif", () => {
    const r = ceAnswerSubmitSchema.safeParse({
      questionId: "q-uuid",
      chosenIdx: -1,
      playerToken: "12345678-aa-bb",
    });
    expect(r.success).toBe(false);
  });

  it("rejette un chosenIdx > 20 (anti-spam)", () => {
    const r = ceAnswerSubmitSchema.safeParse({
      questionId: "q-uuid",
      chosenIdx: 999,
      playerToken: "12345678-aa-bb",
    });
    expect(r.success).toBe(false);
  });

  it("rejette un token trop court", () => {
    const r = ceAnswerSubmitSchema.safeParse({
      questionId: "q-uuid",
      chosenIdx: 0,
      playerToken: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejette un payload sans token", () => {
    const r = ceAnswerSubmitSchema.safeParse({
      questionId: "q-uuid",
      chosenIdx: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejette un payload null/undefined", () => {
    expect(ceAnswerSubmitSchema.safeParse(null).success).toBe(false);
    expect(ceAnswerSubmitSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("cpcAnswerSubmitSchema", () => {
  it("accepte un payload CPC valide", () => {
    const r = cpcAnswerSubmitSchema.safeParse({
      questionId: "q-uuid-12",
      chosenIdx: 4,
      playerToken: "abcdefgh",
    });
    expect(r.success).toBe(true);
  });
});

describe("ceDuelCandidateSelectedSchema", () => {
  it("accepte un payload valide", () => {
    const r = ceDuelCandidateSelectedSchema.safeParse({
      challengerToken: "12345678-aa",
      candidateToken: "abcdefgh-bb",
      candidatePseudo: "Bob",
    });
    expect(r.success).toBe(true);
  });

  it("rejette un pseudo vide", () => {
    const r = ceDuelCandidateSelectedSchema.safeParse({
      challengerToken: "12345678-aa",
      candidateToken: "abcdefgh-bb",
      candidatePseudo: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejette un pseudo trop long (anti-XSS basique)", () => {
    const r = ceDuelCandidateSelectedSchema.safeParse({
      challengerToken: "12345678-aa",
      candidateToken: "abcdefgh-bb",
      candidatePseudo: "x".repeat(200),
    });
    expect(r.success).toBe(false);
  });
});

describe("ceDuelThemeChosenSchema", () => {
  it("accepte un themeId positif", () => {
    const r = ceDuelThemeChosenSchema.safeParse({
      candidateToken: "abcdefgh-bb",
      themeId: 5,
      themeNom: "Histoire",
    });
    expect(r.success).toBe(true);
  });

  it("rejette un themeId négatif", () => {
    const r = ceDuelThemeChosenSchema.safeParse({
      candidateToken: "abcdefgh-bb",
      themeId: -1,
      themeNom: "Histoire",
    });
    expect(r.success).toBe(false);
  });

  it("rejette un themeId non-entier", () => {
    const r = ceDuelThemeChosenSchema.safeParse({
      candidateToken: "abcdefgh-bb",
      themeId: 1.5,
      themeNom: "Histoire",
    });
    expect(r.success).toBe(false);
  });
});

describe("ceDuelAnswerSubmitSchema", () => {
  it("accepte un payload duel-answer valide", () => {
    const r = ceDuelAnswerSubmitSchema.safeParse({
      questionId: "qd-1",
      chosenIdx: 2,
      candidateToken: "abcdefgh-bb",
    });
    expect(r.success).toBe(true);
  });
});

describe("faVoteCastSchema", () => {
  it("accepte un vote valide", () => {
    const r = faVoteCastSchema.safeParse({
      voterToken: "abcdefgh-1",
      forToken: "abcdefgh-2",
    });
    expect(r.success).toBe(true);
  });
});

describe("faGoSchema / faAnswerSchema / faEndSchema", () => {
  it("faGo accepte un presenterToken", () => {
    expect(
      faGoSchema.safeParse({ presenterToken: "abcdefgh-1" }).success,
    ).toBe(true);
  });
  it("faAnswer rejette un isCorrect non-booléen", () => {
    const r = faAnswerSchema.safeParse({
      presenterToken: "abcdefgh-1",
      challengerToken: "abcdefgh-2",
      isCorrect: "yes" as unknown,
    });
    expect(r.success).toBe(false);
  });
  it("faEnd accepte winner/loser", () => {
    expect(
      faEndSchema.safeParse({
        winnerToken: "abcdefgh-1",
        loserToken: "abcdefgh-2",
      }).success,
    ).toBe(true);
  });
});

describe("heartbeatSchema", () => {
  it("accepte un token", () => {
    expect(
      heartbeatSchema.safeParse({ playerToken: "abcdefgh-1" }).success,
    ).toBe(true);
  });
});

describe("safeParseEvent", () => {
  it("retourne le payload typé en cas de succès", () => {
    const r = safeParseEvent("test", ceAnswerSubmitSchema, {
      questionId: "q",
      chosenIdx: 0,
      playerToken: "12345678-aa",
    });
    expect(r).not.toBeNull();
    expect(r?.chosenIdx).toBe(0);
  });

  it("retourne null et log en cas d'échec", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = safeParseEvent("test-event", ceAnswerSubmitSchema, { invalid: true });
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('event "test-event" rejected'),
      expect.any(String),
    );
    warn.mockRestore();
  });
});
