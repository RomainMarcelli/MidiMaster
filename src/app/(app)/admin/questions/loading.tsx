import { Skeleton, SkeletonTableRow } from "@/components/ui/Skeleton";

/**
 * Vague S8 — Loading skeleton de la page Admin Questions. Affiché par
 * Next.js automatiquement pendant le RSC streaming (avant que le
 * server component ait fini de fetcher les questions).
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-10 w-32 rounded-full" />
      </header>
      <Skeleton className="h-12 w-full rounded-2xl" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonTableRow key={i} cols={4} />
        ))}
      </div>
    </main>
  );
}
