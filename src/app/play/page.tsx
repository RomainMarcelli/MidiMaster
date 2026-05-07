import { Tv } from "lucide-react";
import { JoinByCodeForm } from "./join-form";

export const metadata = { title: "Rejoindre une partie" };

/**
 * H4.4 — Page de rejoinde une partie TV par code à 4 chiffres.
 * Accessible aux utilisateurs NON connectés (cf. middleware
 * `isPublicPath` : `/play` et `/play/*` sont publics).
 *
 * Vague U (#3) — Layout responsive PC : sur mobile, le form est centré
 * en plein écran. Sur desktop (md+), 2 colonnes côte à côte (illustration
 * + formulaire) dans un container max-w-5xl, fond gradient navy/or qui
 * transforme la page d'accueil "rejoindre" en mini-page valorisée.
 */
export default function JoinPlayPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-4 md:p-8">
      <div className="grid w-full max-w-5xl items-center gap-8 md:grid-cols-2 md:gap-12">
        {/* Illustration desktop only — colonne décorative à gauche. */}
        <aside className="hidden flex-col items-center justify-center gap-5 text-center md:flex">
          <div className="flex h-32 w-32 items-center justify-center rounded-3xl bg-gold/20 text-gold-warm shadow-[0_8px_40px_rgba(245,183,0,0.35)]">
            <Tv className="h-16 w-16" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
              Mahylan Quiz · Mode TV
            </p>
            <h2 className="mt-1 font-display text-4xl font-extrabold text-foreground">
              Soirée quiz entre amis
            </h2>
            <p className="mt-3 max-w-sm text-base text-foreground/70">
              L&apos;hôte affiche le code de la partie sur la TV. Tape ce
              code à droite pour rejoindre depuis ton téléphone.
            </p>
          </div>
        </aside>

        {/* Form (mobile et desktop) */}
        <div className="flex flex-col items-center text-center">
          <JoinByCodeForm />
        </div>
      </div>
    </main>
  );
}
