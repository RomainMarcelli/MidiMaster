/**
 * Pack d'avatars pré-définis (F3.2).
 *
 * Approche pragmatique : on utilise les URLs DiceBear directement
 * (https://api.dicebear.com/9.x/<style>/svg?seed=<seed>). Pas besoin
 * de télécharger localement — DiceBear sert les SVG en CDN.
 *
 * Si l'API DiceBear devient indisponible, fallback :
 *   1. L'utilisateur garde l'avatar actuel (rien ne casse)
 *   2. On peut basculer plus tard sur des fichiers SVG locaux dans
 *      `/public/avatars/preset/` en remplaçant juste les URLs.
 */

export type DicebearStyle =
  | "avataaars"
  | "bottts"
  | "fun-emoji"
  | "pixel-art"
  | "lorelei";

export interface AvatarPreset {
  id: string;
  label: string;
  style: DicebearStyle;
  seed: string;
  url: string;
}

const ALL_STYLES: DicebearStyle[] = [
  "avataaars",
  "bottts",
  "fun-emoji",
  "pixel-art",
  "lorelei",
];

function buildUrl(style: DicebearStyle, seed: string): string {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

/** Pack fixe de 16 avatars pour le sélecteur. */
export const AVATAR_PACK: AvatarPreset[] = [
  // Avataaars (4)
  { id: "hero", label: "Héros", style: "avataaars", seed: "hero", url: buildUrl("avataaars", "hero") },
  { id: "wizard", label: "Sage", style: "avataaars", seed: "wizard-mahylan", url: buildUrl("avataaars", "wizard-mahylan") },
  { id: "knight", label: "Chevalier", style: "avataaars", seed: "knight-of-mahylan", url: buildUrl("avataaars", "knight-of-mahylan") },
  { id: "queen", label: "Reine", style: "avataaars", seed: "queen-of-quizz", url: buildUrl("avataaars", "queen-of-quizz") },
  // Bottts (4)
  { id: "bot-r2", label: "R2", style: "bottts", seed: "r2-mahylan", url: buildUrl("bottts", "r2-mahylan") },
  { id: "bot-pixel", label: "Pixel", style: "bottts", seed: "pixel-bot", url: buildUrl("bottts", "pixel-bot") },
  { id: "bot-omega", label: "Omega", style: "bottts", seed: "omega-prime", url: buildUrl("bottts", "omega-prime") },
  { id: "bot-spark", label: "Spark", style: "bottts", seed: "sparky", url: buildUrl("bottts", "sparky") },
  // Fun-emoji (4)
  { id: "emoji-cat", label: "Chat", style: "fun-emoji", seed: "cat-12-coups", url: buildUrl("fun-emoji", "cat-12-coups") },
  { id: "emoji-fox", label: "Renard", style: "fun-emoji", seed: "fox-mahylan", url: buildUrl("fun-emoji", "fox-mahylan") },
  { id: "emoji-owl", label: "Hibou", style: "fun-emoji", seed: "wise-owl", url: buildUrl("fun-emoji", "wise-owl") },
  { id: "emoji-fish", label: "Poisson", style: "fun-emoji", seed: "lucky-fish", url: buildUrl("fun-emoji", "lucky-fish") },
  // Pixel-art (2)
  { id: "pixel-warrior", label: "Pixel", style: "pixel-art", seed: "warrior-pixel", url: buildUrl("pixel-art", "warrior-pixel") },
  { id: "pixel-mage", label: "Mage", style: "pixel-art", seed: "mage-of-12", url: buildUrl("pixel-art", "mage-of-12") },
  // Lorelei (2)
  { id: "lor-1", label: "Style", style: "lorelei", seed: "lor-style-1", url: buildUrl("lorelei", "lor-style-1") },
  { id: "lor-2", label: "Classe", style: "lorelei", seed: "lor-classy", url: buildUrl("lorelei", "lor-classy") },
];

/** Génère une URL DiceBear avec un seed aléatoire pour un style donné. */
export function generateRandomAvatar(style: DicebearStyle): string {
  const seed = `mahylan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return buildUrl(style, seed);
}

/**
 * Vague U (#5) — Pioche un avatar pré-défini au hasard pour un bot.
 * Préférence pour les styles "bottts" (robots) pour rester cohérent
 * avec l'identité bot, mais on accepte aussi un mélange de tous les
 * styles pour la variété visuelle. `rng` injectable pour les tests.
 */
export function pickRandomBotAvatarUrl(rng: () => number = Math.random): string {
  const i = Math.floor(rng() * AVATAR_PACK.length);
  return AVATAR_PACK[i]?.url ?? AVATAR_PACK[0]!.url;
}

export const DICEBEAR_STYLES: ReadonlyArray<{
  id: DicebearStyle;
  label: string;
}> = [
  { id: "avataaars", label: "Cartoon" },
  { id: "bottts", label: "Robots" },
  { id: "fun-emoji", label: "Emojis" },
  { id: "pixel-art", label: "Pixel Art" },
  { id: "lorelei", label: "Stylé" },
];

void ALL_STYLES;
