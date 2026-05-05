/**
 * Vague S3 — Logique pure utilisée par `bot-actions.ts`. Extraite ici
 * pour pouvoir être testée unitairement sans monter de mock Supabase.
 */

/** Limites métier pour la gestion des bots dans une room. */
export const BOT_ROOM_LIMITS = {
  MAX_PLAYERS_PER_ROOM: 8,
  DEFAULT_SKILL: 70,
  MIN_SKILL: 0,
  MAX_SKILL: 100,
} as const;

/**
 * Calcule le pseudo du prochain bot à ajouter : "Bot N" où N = nombre
 * de bots existants + 1. Détecte les bots par 2 critères :
 *  - le flag `is_bot` (BDD column, peut être absent si migration pas
 *    appliquée)
 *  - OU le préfixe "bot:" du token (filet de sécurité)
 */
export function computeNextBotPseudo(
  existingPlayers: Array<{ player_token: string; is_bot?: boolean }>,
): string {
  const botCount = existingPlayers.filter(
    (p) => p.is_bot === true || p.player_token.startsWith("bot:"),
  ).length;
  return `Bot ${botCount + 1}`;
}

/** Borne le skill dans [MIN_SKILL, MAX_SKILL] et arrondit à l'entier. */
export function clampBotSkill(skill: number): number {
  return Math.max(
    BOT_ROOM_LIMITS.MIN_SKILL,
    Math.min(BOT_ROOM_LIMITS.MAX_SKILL, Math.floor(skill)),
  );
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Valide qu'on peut ajouter un bot à une room :
 *  - room status doit être "waiting"
 *  - total joueurs courants < MAX_PLAYERS_PER_ROOM
 */
export function validateBotAdd(
  roomStatus: string,
  totalPlayers: number,
): ValidationResult {
  if (roomStatus !== "waiting") {
    return {
      ok: false,
      message: "Impossible d'ajouter un bot après le démarrage de la partie.",
    };
  }
  if (totalPlayers >= BOT_ROOM_LIMITS.MAX_PLAYERS_PER_ROOM) {
    return {
      ok: false,
      message: `Maximum ${BOT_ROOM_LIMITS.MAX_PLAYERS_PER_ROOM} joueurs par room.`,
    };
  }
  return { ok: true };
}

/**
 * Valide qu'on peut retirer un bot :
 *  - le token doit être préfixé "bot:" (sinon c'est un humain ou erreur)
 *  - room status doit être "waiting"
 */
export function validateBotRemove(
  roomStatus: string,
  botToken: string,
): ValidationResult {
  if (!botToken.startsWith("bot:")) {
    return { ok: false, message: "Token invalide (pas un bot)." };
  }
  if (roomStatus !== "waiting") {
    return {
      ok: false,
      message: "Impossible de retirer un bot après le démarrage.",
    };
  }
  return { ok: true };
}
