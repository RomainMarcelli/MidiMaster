/**
 * Vague T (#7) — Setup global pour les tests jsdom + React Testing Library.
 *
 * Ajoute les matchers `@testing-library/jest-dom` (`.toBeInTheDocument`,
 * `.toHaveClass`, etc.) à `expect`. Importé via `setupFiles` dans
 * `vitest.config.ts` pour les fichiers `.test.tsx` uniquement.
 *
 * On mock `framer-motion` pour éviter ses animations qui :
 *  1. ne se terminent jamais (`Infinity` repeat) → bloquent les tests
 *  2. utilisent des features WebAPI non implémentées par jsdom
 *  3. ne sont pas l'objet du test (on teste le DOM rendu, pas l'anim)
 *
 * Les `motion.X` deviennent des `<X>` natifs et `AnimatePresence` rend
 * juste ses enfants. Les props "framer" (whileHover, animate, etc.) sont
 * silencieusement ignorées par les éléments natifs.
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Vague T (#7) — RTL ne nettoie PAS automatiquement entre les tests
// quand on l'utilise avec Vitest (par défaut), contrairement à Jest.
// Sans ça, les renders s'accumulent et getByLabelText trouve plusieurs
// matches après le 2e test.
afterEach(() => {
  cleanup();
});

// Liste non exhaustive des props framer-motion à filtrer pour éviter
// les warnings "Unknown prop on <div>" en mode test.
const FRAMER_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "transition",
  "variants",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
  "whileInView",
  "viewport",
  "layout",
  "layoutId",
  "drag",
  "dragConstraints",
  "dragElastic",
  "onAnimationComplete",
  "onAnimationStart",
  "custom",
]);

vi.mock("framer-motion", () => {
  // Cache des composants stub : un seul Component par tag pour ne pas
  // réinstancier React à chaque rendu (sinon perte de re-mount + DOM
  // dupliqué dans certains cas).
  const stubCache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  const stubFor = (tag: string) => {
    const cached = stubCache.get(tag);
    if (cached) return cached;
    const Component = React.forwardRef<HTMLElement, Record<string, unknown>>(
      function MotionStub(props, ref) {
        const { children, ...rest } = props;
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (FRAMER_PROPS.has(key)) continue;
          filtered[key] = value;
        }
        return React.createElement(
          tag,
          { ...filtered, ref },
          children as React.ReactNode,
        );
      },
    );
    Component.displayName = `motion.${tag}`;
    stubCache.set(tag, Component as unknown as React.ComponentType<Record<string, unknown>>);
    return Component;
  };

  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) => stubFor(prop),
    },
  );

  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useReducedMotion: () => false,
    useAnimation: () => ({ start: () => Promise.resolve() }),
    useMotionValue: <T,>(v: T) => ({ get: () => v, set: () => {} }),
    useTransform: <T,>(_v: unknown, fn: (input: number) => T) => ({
      get: () => fn(0),
      set: () => {},
    }),
  };
});
