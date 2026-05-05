import { Skeleton, SkeletonPlayerCard } from "@/components/ui/Skeleton";

/**
 * Vague S8 — Loading skeleton de la page TV host. Pendant le fetch
 * server du status de la room + de la liste initiale des joueurs.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-48" />
          </div>
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        {/* QR + code */}
        <section className="flex flex-col items-center gap-5 rounded-3xl border border-gold/30 bg-card/50 p-8">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-[280px] w-[280px] rounded-2xl" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-16 w-64" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </section>
        {/* Joueurs */}
        <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-12 rounded-full" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonPlayerCard key={i} />
          ))}
          <Skeleton className="mt-auto h-12 w-full rounded-md" />
        </section>
      </div>
    </main>
  );
}
