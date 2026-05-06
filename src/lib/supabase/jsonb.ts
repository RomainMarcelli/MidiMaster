import type { Json } from "@/types/database";

/**
 * Vague T (#5) — Cast d'un objet métier vers le type `Json` attendu par
 * les UPDATE/INSERT Supabase sur les colonnes JSONB.
 *
 * **Pourquoi un helper plutôt qu'`as any` éparpillé** : nos types métier
 * (TvDouzeCoupsState, FaceAFaceState, GameState, etc.) sont sérialisables
 * JSON par construction, mais TypeScript ne peut pas le prouver — un type
 * récursif `Json` ne se réconcilie pas avec un struct nominal. Un cast est
 * donc inévitable. En centralisant ici, on a :
 *  - 0 occurrence de `as any` dans les server actions
 *  - 1 seul endroit à auditer si on veut renforcer (zod parse avant cast,
 *    ou typage strict via `JsonCompatible<T>` au moment du build)
 *  - une grep-clé `asJsonb` pour retrouver tous les boundary points.
 *
 * **Ce que ça ne fait pas** : aucune validation runtime. Si tu passes un
 * objet avec des `Date`, `Map`, `Set`, `BigInt` ou cycles, Supabase refusera
 * (500). Faut s'assurer à la source que le type est sérialisable.
 */
export function asJsonb<T>(value: T): Json {
  return value as unknown as Json;
}
