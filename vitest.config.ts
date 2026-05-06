import { defineConfig } from "vitest/config";

/**
 * Vague T (#7) — On bascule en mode "projects" avec deux environnements :
 *  - "node" pour les tests purs (logique métier, helpers, schémas Zod)
 *  - "jsdom" pour les tests de composants React (RTL)
 *
 * Critère de routing : nom du fichier.
 *  - `*.test.ts`  → environnement Node (par défaut)
 *  - `*.test.tsx` → environnement jsdom (avec setup RTL)
 *
 * Ça nous permet de garder les tests métier ultra-rapides (sans DOM) tout
 * en ajoutant la possibilité de tester du JSX. Le helper `setup-rtl.ts`
 * importe `@testing-library/jest-dom` pour les matchers comme
 * `.toBeInTheDocument()` / `.toHaveClass()`.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    exclude: ["node_modules", ".next", "dist"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-rtl.ts"],
        },
      },
    ],
  },
});
