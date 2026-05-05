import type { LifeStatus } from "@/lib/realtime/tv-douze-coups-state";

/**
 * Vague S6 — Décide si on doit déclencher le flash buzz 800 ms sur le card
 * joueur suite à un changement de statut de vie.
 *
 * Règle : on flash UNIQUEMENT sur dégradation (perte de vie). Pas de flash :
 *  - quand le statut est inchangé (idem-idem)
 *  - quand on remonte (orange→green : impossible en jeu mais sans bug)
 *  - quand on est déjà éliminé
 *  - sur la première render (le caller doit gérer cela en initialisant
 *    `prev` avec la valeur courante)
 *
 * Cette fonction est extraite du composant pour pouvoir être testée
 * unitairement sans monter React (vitest configuré en `node`).
 */
export function shouldFlashOnLifeChange(
  prev: LifeStatus,
  curr: LifeStatus,
): boolean {
  if (prev === curr) return false;
  if (prev === "green" && (curr === "orange" || curr === "red")) return true;
  if (prev === "orange" && curr === "red") return true;
  return false;
}

/**
 * Classes Tailwind pour la bordure du card joueur selon vie + état éliminé.
 */
export function lifeBorderClass(
  status: LifeStatus,
  eliminated: boolean,
): string {
  if (eliminated) return "border-buzz/30 bg-card/30";
  switch (status) {
    case "green":
      return "border-life-green bg-life-green/5";
    case "orange":
      return "border-life-yellow bg-life-yellow/10";
    case "red":
      return "border-buzz bg-buzz/10";
  }
}

/**
 * Classes Tailwind pour le glow / shadow selon vie.
 */
export function lifeShadowClass(
  status: LifeStatus,
  eliminated: boolean,
): string {
  if (eliminated) return "";
  switch (status) {
    case "green":
      return "shadow-[0_0_24px_rgba(58,164,86,0.25)]";
    case "orange":
      return "shadow-[0_0_24px_rgba(245,183,0,0.3)]";
    case "red":
      return "shadow-[0_0_28px_rgba(206,31,67,0.4)]";
  }
}
