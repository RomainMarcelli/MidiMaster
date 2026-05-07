import { cn } from "@/lib/utils";

/**
 * Vague S8 — Composant Skeleton réutilisable. Fond gris translucide qui
 * pulse via `animate-pulse`. À utiliser dans les `Suspense` boundary
 * fallback ou en attendant une donnée client.
 *
 * Exemples :
 *   <Skeleton className="h-8 w-32 rounded" />
 *   <Skeleton className="h-12 w-12 rounded-full" />
 *   <Skeleton className="h-4 w-full" />
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-foreground/10",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Skeleton pour ligne de tableau (3-5 cellules typiques).
 * Utilisée dans `/admin/questions` notamment.
 */
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-5 flex-1"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

/** Skeleton pour card joueur (avatar rond + 2 lignes). */
export function SkeletonPlayerCard() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <Skeleton className="h-12 w-12 rounded-xl" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}
