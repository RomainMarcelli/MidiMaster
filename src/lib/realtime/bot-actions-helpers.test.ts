import { describe, expect, it } from "vitest";
import {
  BOT_ROOM_LIMITS,
  clampBotSkill,
  computeNextBotPseudo,
  validateBotAdd,
  validateBotRemove,
} from "./bot-actions-helpers";

describe("computeNextBotPseudo", () => {
  it("0 bots existants → 'Bot 1'", () => {
    expect(computeNextBotPseudo([])).toBe("Bot 1");
  });

  it("compte les bots via flag is_bot", () => {
    expect(
      computeNextBotPseudo([
        { player_token: "human-uuid-1", is_bot: false },
        { player_token: "bot:uuid-a", is_bot: true },
      ]),
    ).toBe("Bot 2");
  });

  it("compte les bots via préfixe 'bot:' (fallback si is_bot absent)", () => {
    // is_bot non fourni → on tombe sur le fallback préfixe
    expect(
      computeNextBotPseudo([
        { player_token: "bot:uuid-a" },
        { player_token: "bot:uuid-b" },
        { player_token: "human-uuid" },
      ]),
    ).toBe("Bot 3");
  });

  it("ne mélange pas humains et bots", () => {
    expect(
      computeNextBotPseudo([
        { player_token: "human-1" },
        { player_token: "human-2" },
        { player_token: "human-3" },
      ]),
    ).toBe("Bot 1");
  });
});

describe("clampBotSkill", () => {
  it("valeur dans la plage retournée telle quelle", () => {
    expect(clampBotSkill(50)).toBe(50);
    expect(clampBotSkill(70)).toBe(70);
    expect(clampBotSkill(0)).toBe(0);
    expect(clampBotSkill(100)).toBe(100);
  });

  it("borne par le bas (min 0)", () => {
    expect(clampBotSkill(-50)).toBe(0);
    expect(clampBotSkill(-1)).toBe(0);
  });

  it("borne par le haut (max 100)", () => {
    expect(clampBotSkill(150)).toBe(100);
    expect(clampBotSkill(101)).toBe(100);
  });

  it("arrondit à l'entier inférieur", () => {
    expect(clampBotSkill(70.9)).toBe(70);
    expect(clampBotSkill(40.5)).toBe(40);
  });
});

describe("validateBotAdd", () => {
  it("ok : status='waiting' + nb < limite", () => {
    expect(validateBotAdd("waiting", 0)).toEqual({ ok: true });
    expect(validateBotAdd("waiting", 7)).toEqual({ ok: true });
  });

  it("erreur : status != waiting (partie démarrée)", () => {
    const res = validateBotAdd("playing", 2);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("démarrage");
    }
  });

  it("erreur : limite max atteinte (8 joueurs)", () => {
    const res = validateBotAdd("waiting", BOT_ROOM_LIMITS.MAX_PLAYERS_PER_ROOM);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("Maximum");
    }
  });

  it("erreur : status='ended' (partie terminée)", () => {
    expect(validateBotAdd("ended", 2).ok).toBe(false);
  });
});

describe("validateBotRemove", () => {
  it("ok : token bot + status='waiting'", () => {
    expect(validateBotRemove("waiting", "bot:abc-def")).toEqual({ ok: true });
  });

  it("erreur : token non préfixé 'bot:' (humain ou erreur)", () => {
    const res = validateBotRemove("waiting", "human-uuid");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("Token invalide");
    }
  });

  it("erreur : status != waiting", () => {
    const res = validateBotRemove("playing", "bot:uuid");
    expect(res.ok).toBe(false);
  });

  it("token vide → invalide", () => {
    expect(validateBotRemove("waiting", "").ok).toBe(false);
  });
});

describe("BOT_ROOM_LIMITS constants", () => {
  it("expose les limites métier", () => {
    expect(BOT_ROOM_LIMITS.MAX_PLAYERS_PER_ROOM).toBe(8);
    expect(BOT_ROOM_LIMITS.DEFAULT_SKILL).toBe(70);
    expect(BOT_ROOM_LIMITS.MIN_SKILL).toBe(0);
    expect(BOT_ROOM_LIMITS.MAX_SKILL).toBe(100);
  });
});
