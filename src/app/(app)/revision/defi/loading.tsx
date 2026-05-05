import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Vague S8 — Loading skeleton de la page Défi quotidien. Pendant le
 * fetch du calendrier + des stats utilisateur.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-80" />
      </header>
      <Skeleton className="h-72 w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-md" />
    </main>
  );
}
