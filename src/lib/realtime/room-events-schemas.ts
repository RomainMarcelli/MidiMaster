/**
 * Vague T (#4) — Schémas Zod pour les events entrants côté hôte.
 *
 * Avant : les payloads broadcast étaient typés mais JAMAIS validés à la
 * réception. Un téléphone (humain malveillant ou vieux build buggé) pouvait
 * envoyer un event mal formé qui crashait silencieusement l'orchestrateur,
 * ou un payload truqué (`playerToken` qui ne correspond pas au sien).
 *
 * Maintenant : on parse chaque event à l'entrée du `channel.on()`. Les
 * events refusés sont loggés et ignorés ; l'orchestrateur ne reçoit que des
 * payloads bien formés. La sécurité métier (corrélation token / tour de
 * table / etc.) reste à la charge des helpers de la state machine
 * (`applyAnswer`, `applyDuelAnswer`, etc.).
 *
 * On ne valide PAS les events sortants (host → phones) : si l'hôte broadcast
 * un truc bidon, c'est un bug local qui se voit en dev.
 */

import { z } from "zod";

// ============================================================================
// Schémas de base
// ============================================================================

/** Token joueur : UUID, "bot:UUID", "host:UUID", ou format custom — on impose
 *  juste une longueur min/max raisonnable pour éviter les payloads farfelus. */
const tokenSchema = z.string().min(8).max(128);
const uuidSchema = z.string().min(1).max(128);

// ============================================================================
// Events Mode 12 Coups TV (entrants côté hôte)
// ============================================================================

export const ceAnswerSubmitSchema = z.object({
  questionId: uuidSchema,
  chosenIdx: z.number().int().min(0).max(20),
  playerToken: tokenSchema,
});

export const ceDuelCandidateSelectedSchema = z.object({
  challengerToken: tokenSchema,
  candidateToken: tokenSchema,
  candidatePseudo: z.string().min(1).max(64),
});

export const ceDuelThemeChosenSchema = z.object({
  candidateToken: tokenSchema,
  themeId: z.number().int().nonnegative(),
  themeNom: z.string().max(128),
});

export const ceDuelAnswerSubmitSchema = z.object({
  questionId: uuidSchema,
  chosenIdx: z.number().int().min(0).max(20),
  candidateToken: tokenSchema,
});

export const cpcAnswerSubmitSchema = z.object({
  questionId: uuidSchema,
  chosenIdx: z.number().int().min(0).max(20),
  playerToken: tokenSchema,
});

// ============================================================================
// Events Face-à-Face (entrants côté hôte)
// ============================================================================

export const faVoteCastSchema = z.object({
  voterToken: tokenSchema,
  forToken: tokenSchema,
});

export const faGoSchema = z.object({
  presenterToken: tokenSchema,
});

export const faAnswerSchema = z.object({
  presenterToken: tokenSchema,
  challengerToken: tokenSchema,
  isCorrect: z.boolean(),
});

export const faEndSchema = z.object({
  winnerToken: tokenSchema,
  loserToken: tokenSchema,
});

// ============================================================================
// Heartbeat (entrant générique)
// ============================================================================

export const heartbeatSchema = z.object({
  playerToken: tokenSchema,
});

// ============================================================================
// Helper de validation
// ============================================================================

/**
 * Parse un payload Realtime avec un schéma Zod, log un warning et retourne
 * `null` en cas d'échec. Le caller (typiquement `ch.on(name, (p) => ...)`)
 * ignore alors le payload silencieusement.
 *
 * On donne un nom (`eventName`) pour identifier l'event dans les logs —
 * indispensable quand on essaie de comprendre pourquoi un payload est rejeté.
 */
export function safeParseEvent<T>(
  eventName: string,
  schema: z.ZodType<T>,
  payload: unknown,
): T | null {
  const r = schema.safeParse(payload);
  if (r.success) return r.data;
  // eslint-disable-next-line no-console
  console.warn(
    `[realtime] event "${eventName}" rejected:`,
    r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  );
  return null;
}
