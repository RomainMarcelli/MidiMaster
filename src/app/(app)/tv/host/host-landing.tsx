"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Gamepad2,
  Loader2,
  MonitorPlay,
  QrCode,
  Smartphone,
  Tv,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createTvRoom } from "@/lib/realtime/room-actions";

type RoomMode = "scan" | "remote";

/**
 * Landing visuelle "Créer une partie TV" : explique le concept en 3 lignes
 * (TV affiche, téléphones jouent), bouton de création principal.
 *
 * P4.1 — Choix du mode "scan" (1 téléphone par joueur) vs "remote"
 * (1 seul téléphone régie commande pour tous).
 */
export function TvHostLanding() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RoomMode>("scan");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createTvRoom({ gameMode: "douze_coups", mode });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.push(`/tv/host/${res.code}`);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gold/20 shadow-[0_0_64px_rgba(245,183,0,0.45)]">
        <Tv className="h-12 w-12 text-gold-warm" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-widest text-gold-warm">
          Mode soirée
        </p>
        <h1 className="font-display text-4xl font-extrabold text-foreground sm:text-5xl">
          Lance une partie sur ta TV
        </h1>
        <p className="max-w-xl text-foreground/70 sm:text-lg">
          Affiche les questions sur ton écran. Tes amis rejoignent depuis
          leur téléphone et jouent en live, à plusieurs (jusqu&apos;à 8).
        </p>
      </div>

      <div className="grid w-full gap-3 sm:grid-cols-3">
        <Step icon={MonitorPlay} title="TV affiche" desc="QR code à scanner" />
        <Step icon={Smartphone} title="Tels rejoignent" desc="Code à 4 chiffres" />
        <Step icon={Users} title="2 à 8 joueurs" desc="Tour par tour" />
      </div>

      {/* P4.1 — Choix du mode de jeu : scan (1 tel/joueur) vs remote (1 tel régie). */}
      <div className="flex w-full flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-foreground/50">
          Mode de jeu
        </p>
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <ModeCard
            icon={QrCode}
            title="Scan"
            desc="Chaque joueur a son téléphone (recommandé)"
            selected={mode === "scan"}
            onClick={() => setMode("scan")}
          />
          <ModeCard
            icon={Smartphone}
            title="Télécommande"
            desc="Un seul téléphone pour tous les joueurs"
            selected={mode === "remote"}
            onClick={() => setMode("remote")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-transparent bg-gold px-6 text-lg font-bold text-on-color shadow-[0_4px_0_0_#e89e00] transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(245,183,0,0.55)] active:translate-y-px active:shadow-[0_2px_0_0_#e89e00] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Création…
            </>
          ) : (
            <>
              <Tv className="h-5 w-5" aria-hidden="true" />
              Créer la partie
            </>
          )}
        </button>

        {/* Q1.1 — Bouton "Rejoindre" en style "outline gold" pour cohérence
            avec la DA navy/or (ne pas se distinguer comme un bouton sky qui
            cassait la palette). Mêmes h-12 + px-6 + text-lg que le bouton
            primary pour alignement parfait des 2 CTAs côte à côte. */}
        <Link
          href="/play"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-gold bg-cream px-6 text-lg font-bold text-gold-warm transition-all hover:-translate-y-px hover:bg-gold/10 hover:shadow-[0_5px_16px_rgba(245,183,0,0.35)]"
        >
          <Gamepad2 className="h-5 w-5" aria-hidden="true" />
          Rejoindre une partie
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-buzz/40 bg-buzz/10 px-4 py-2 text-sm text-buzz"
        >
          {error}
        </p>
      )}

      <p className="text-xs text-foreground/50">
        L&apos;écran principal (cette page) doit rester ouvert sur la TV ou
        le PC pendant toute la partie.
      </p>
    </main>
  );
}

function Step({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Tv;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-4">
      <Icon className="h-7 w-7 text-gold-warm" aria-hidden="true" />
      <p className="font-display text-sm font-bold text-foreground">{title}</p>
      <p className="text-xs text-foreground/60">{desc}</p>
    </div>
  );
}

function ModeCard({
  icon: Icon,
  title,
  desc,
  selected,
  onClick,
}: {
  icon: typeof Tv;
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border-2 p-4 text-center transition-colors",
        selected
          ? "border-gold bg-gold/10"
          : "border-border bg-card hover:border-gold/50",
      )}
    >
      <Icon className="h-7 w-7 text-gold-warm" aria-hidden="true" />
      <p className="font-display text-sm font-bold text-foreground">{title}</p>
      <p className="text-xs text-foreground/60">{desc}</p>
    </button>
  );
}
