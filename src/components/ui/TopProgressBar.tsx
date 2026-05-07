"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Vague S8 — Barre de progression fine en haut de page pour signaler
 * une navigation Next.js en cours.
 *
 * Implémentation : on observe `pathname` + `searchParams`. Quand ils
 * changent, on déclenche une animation de progression (0% → 80% en
 * 600ms, puis on attend la fin de la nav, puis 80% → 100% → fade-out).
 *
 * Pas d'NPM `nprogress` : on garde la palette projet (gold) et on
 * évite la dépendance externe (~5kb).
 *
 * Limite : Next.js App Router ne nous donne pas d'évènement
 * navigationStart fiable. On utilise donc un proxy : effet sur
 * `pathname`/`searchParams` qui se déclenche APRÈS la nav. C'est
 * suffisant pour l'effet visuel "feedback de transition".
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    // Animation : 0 → 80 en 200ms, hold, puis 100 → fade
    setProgress(0);
    const tIn = window.setTimeout(() => setProgress(80), 50);
    const tHold = window.setTimeout(() => setProgress(100), 350);
    const tOut = window.setTimeout(() => setProgress(null), 700);
    return () => {
      window.clearTimeout(tIn);
      window.clearTimeout(tHold);
      window.clearTimeout(tOut);
    };
  }, [pathname, searchParams]);

  if (progress === null) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-[9999] h-0.5 bg-transparent"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
    >
      <div
        className="h-full bg-gold shadow-[0_0_8px_rgba(245,183,0,0.8)] transition-[width,opacity] duration-300 ease-out"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
        }}
      />
    </div>
  );
}
