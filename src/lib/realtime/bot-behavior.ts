/**
 * Vague S3 — Logique pure de comportement des bots dans le mode 12 Coups TV.
 *
 * Toutes les fonctions sont déterministes pour un `rng` donné, ce qui permet
 * de tester unitairement les 3 décisions clés :
 *  - Choisir une réponse (avec ou sans la bonne en visée selon `skill`)
 *  - Choisir un candidat de duel (random parmi les vivants ≠ challenger)
 *  - Choisir un thème de duel (random parmi les 2 proposés)
 *
 * Le délai de réponse est aussi calculé ici : 1-3 secondes par défaut pour
 * laisser le suspense côté TV, modulable via les options.
 */

/** True si le token correspond à un bot (préfixe "bot:" généré côté serveur). */
export function isBotToken(token: string): boolean {
  return token.startsWith("bot:");
}

/**
 * Décide si le bot va répondre correctement, en tirant un random < skill/100.
 * skill=70 → 70% de bonnes réponses sur le long terme.
 */
export function botWillAnswerCorrectly(
  skill: number,
  rng: () => number = Math.random,
): boolean {
  const clamped = Math.max(0, Math.min(100, skill));
  return rng() * 100 < clamped;
}

/**
 * Choisit l'index de la réponse du bot.
 *  - Si `botWillAnswerCorrectly` → renvoie correctIdx
 *  - Sinon → renvoie un index ≠ correctIdx au hasard parmi les autres
 */
export function pickBotAnswerIdx(
  totalChoices: number,
  correctIdx: number,
  skill: number,
  rng: () => number = Math.random,
): number {
  if (totalChoices <= 0) return 0;
  if (botWillAnswerCorrectly(skill, rng)) return correctIdx;
  // Mauvaise réponse : on choisit au hasard parmi les autres
  const wrongs: number[] = [];
  for (let i = 0; i < totalChoices; i++) {
    if (i !== correctIdx) wrongs.push(i);
  }
  if (wrongs.length === 0) return correctIdx;
  return wrongs[Math.floor(rng() * wrongs.length)]!;
}

/**
 * Choisit un candidat de duel pour un bot challenger : random parmi les
 * adversaires vivants ≠ lui-même.
 *
 * Retourne `null` s'il n'y a aucun candidat possible.
 */
export function pickBotDuelCandidate(
  candidates: Array<{ token: string; isEliminated: boolean }>,
  challengerToken: string,
  rng: () => number = Math.random,
): string | null {
  const eligible = candidates.filter(
    (p) => !p.isEliminated && p.token !== challengerToken,
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(rng() * eligible.length)]!.token;
}

/**
 * Choisit un thème de duel pour un bot candidat : random parmi les 2
 * proposés (pas de stratégie, juste random pour l'instant).
 */
export function pickBotDuelTheme(
  themes: Array<{ id: number }>,
  rng: () => number = Math.random,
): number | null {
  if (themes.length === 0) return null;
  return themes[Math.floor(rng() * themes.length)]!.id;
}

/**
 * Délai de "réflexion" du bot avant de soumettre sa réponse / son choix.
 * Entre minMs et maxMs (inclusif) pour donner du suspense côté TV.
 */
export function pickBotDelayMs(
  rng: () => number = Math.random,
  minMs = 1200,
  maxMs = 3000,
): number {
  const min = Math.max(0, minMs);
  const max = Math.max(min, maxMs);
  return Math.round(min + rng() * (max - min));
}

/**
 * Vague V (#5) — Choisit le prochain clic du bot en CPC continu.
 *
 * Sémantique : à chaque clic, avec proba `(1 - skill/100)` le bot tombe sur
 * l'intrus (mauvaise réponse → vie -1). Sinon, il clique une bonne pas
 * encore trouvée. La boucle est gérée par l'orchestrateur côté host : à
 * chaque "correct-continue", il rappelle cette fonction pour le clic suivant.
 *
 * Retourne `null` si toutes les bonnes ont été trouvées (le caller arrête
 * la boucle ; la state machine retournera "series-complete").
 */
export function pickBotCpcNextIdx(
  totalPropositions: number,
  intrusIdx: number,
  foundIndices: number[],
  skill: number,
  rng: () => number = Math.random,
): number | null {
  // Liste des idx encore disponibles (pas l'intrus, pas déjà trouvé).
  const availableCorrects: number[] = [];
  for (let i = 0; i < totalPropositions; i++) {
    if (i !== intrusIdx && !foundIndices.includes(i)) {
      availableCorrects.push(i);
    }
  }
  if (availableCorrects.length === 0) return null; // tout trouvé
  // Avec proba (1-skill/100) → cliquer l'intrus (mauvaise)
  if (!botWillAnswerCorrectly(skill, rng)) return intrusIdx;
  // Sinon : random parmi les bonnes restantes
  return availableCorrects[Math.floor(rng() * availableCorrects.length)]!;
}
