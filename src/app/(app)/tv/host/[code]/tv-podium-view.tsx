"use client";

import { motion } from "framer-motion";
import { Crown, RefreshCw, Trophy, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { AnimEffect } from "@/components/animations/AnimEffect";
import type {
  DcPlayer,
  FinalRanking,
} from "@/lib/realtime/tv-douze-coups-state";

/**
 * Vague R — Podium final du mode 12 Coups TV. Affiche les 4 (ou moins)
 * joueurs classés du 1er au dernier, avec confettis et couronne dorée
 * sur le vainqueur. Boutons :
 *  - Recommencer : reset la room en lobby (mêmes joueurs)
 *  - Quitter : ferme la partie
 */
export function TvPodiumView({
  ranking,
  players,
  onRestart,
  onQuit,
}: {
  ranking: FinalRanking[];
  players: DcPlayer[];
  onRestart: () => void;
  onQuit: () => void;
}) {
  const playerByToken = new Map(players.map((p) => [p.token, p]));
  const winner = ranking[0];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <AnimEffect animation="crown" size="lg" autoCloseMs={0} />
      <AnimEffect animation="coins-rain" size="fullscreen" autoCloseMs={3500} />

      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-gold-warm">
          12 Coups · Partie terminée
        </p>
        <h1 className="font-display text-5xl font-extrabold text-foreground">
          {winner ? `${winner.pseudo} gagne !` : "Pas de vainqueur"}
        </h1>
      </header>

      <ul className="flex w-full flex-col gap-3 rounded-3xl border border-border bg-card p-6 glow-card">
        {ranking.map((r, i) => {
          const p = playerByToken.get(r.token);
          const isWinner = i === 0;
          return (
            <motion.li
              key={r.token}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15 }}
              className={
                isWinner
                  ? "flex items-center gap-4 rounded-2xl border-2 border-gold bg-gold/15 p-3 shadow-[0_0_24px_rgba(245,183,0,0.5)]"
                  : "flex items-center gap-4 rounded-2xl border border-border bg-background/40 p-3"
              }
            >
              <span
                className={
                  isWinner
                    ? "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold text-on-color font-display text-2xl font-extrabold"
                    : "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground/10 font-display text-xl font-extrabold text-foreground"
                }
              >
                {r.rank}
              </span>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gold/15">
                {p?.avatarUrl ? (
                  <Image
                    src={p.avatarUrl}
                    alt=""
                    width={56}
                    height={56}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <Crown className="h-7 w-7 text-gold-warm" aria-hidden="true" />
                )}
              </div>
              <div className="flex-1 text-left">
                <p
                  className={
                    isWinner
                      ? "font-display text-2xl font-extrabold text-gold-warm"
                      : "font-display text-xl font-extrabold text-foreground"
                  }
                >
                  {r.pseudo}
                </p>
                <p className="text-xs text-foreground/60">
                  {p?.score ?? 0} bonne{(p?.score ?? 0) > 1 ? "s" : ""}{" "}
                  réponse{(p?.score ?? 0) > 1 ? "s" : ""}
                </p>
              </div>
              {isWinner && (
                <Trophy
                  className="h-8 w-8 text-gold-warm"
                  aria-hidden="true"
                  fill="currentColor"
                />
              )}
            </motion.li>
          );
        })}
      </ul>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Button
          variant="gold"
          size="lg"
          onClick={onRestart}
          className="min-w-[200px] gap-2"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          Recommencer
        </Button>
        <button
          type="button"
          onClick={onQuit}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-buzz/30 bg-card px-5 py-3 text-base font-semibold text-buzz hover:border-buzz hover:bg-buzz/10"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Quitter
        </button>
      </div>
    </main>
  );
}
