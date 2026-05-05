"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, Loader2, Swords } from "lucide-react";
import Image from "next/image";
import {
  type DcPlayer,
  type DuelTheme,
  type QuizzQuestion,
  type TvGamePhase,
} from "@/lib/realtime/tv-douze-coups-state";

/**
 * Vague R — Vue TV pour les phases de DUEL (commun aux étapes Coup
 * d'Envoi et Coup par Coup). Affiche les 2 protagonistes en grand,
 * l'évolution du duel selon la sous-phase :
 *  - duel-select : "X choisit son adversaire…"
 *  - duel-theme  : "Y choisit son thème…" + 2 options visibles
 *  - duel-question : la question quizz_4 + réponses
 */
export function TvDuelView({
  phase,
  challenger,
  candidate,
  proposedThemes,
  chosenThemeNom,
  question,
}: {
  phase: TvGamePhase;
  challenger: DcPlayer;
  candidate: DcPlayer | null;
  proposedThemes: DuelTheme[];
  chosenThemeNom: string | null;
  question: QuizzQuestion | null;
}) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-3xl border-2 border-buzz/40 bg-gradient-to-br from-cream via-card to-buzz/10 p-6 lg:p-10">
      <header className="flex items-center gap-3">
        <Swords className="h-8 w-8 text-buzz" aria-hidden="true" />
        <h2 className="font-display text-3xl font-black uppercase tracking-widest text-buzz lg:text-4xl">
          Duel
        </h2>
        <Swords className="h-8 w-8 -scale-x-100 text-buzz" aria-hidden="true" />
      </header>

      <div className="grid w-full max-w-3xl grid-cols-2 gap-6">
        <DuelistCard player={challenger} role="Challenger" />
        {candidate ? (
          <DuelistCard player={candidate} role="Candidat" />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-foreground/20 p-6 text-center text-foreground/50">
            <Loader2 className="h-12 w-12 animate-spin" aria-hidden="true" />
            <p className="text-sm">En attente du choix…</p>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {phase === "coup-envoi-duel-select" ||
        phase === "coup-par-coup-duel-select" ? (
          <motion.p
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="font-display text-xl font-bold text-foreground/70 lg:text-2xl"
          >
            {challenger.pseudo} choisit son adversaire…
          </motion.p>
        ) : null}

        {(phase === "coup-envoi-duel-theme" ||
          phase === "coup-par-coup-duel-theme") &&
        candidate ? (
          <motion.div
            key="theme"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <p className="font-display text-lg font-bold text-foreground/70">
              {candidate.pseudo} choisit son thème…
            </p>
            <div className="grid grid-cols-2 gap-3">
              {proposedThemes.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl border-2 border-gold/40 bg-card px-6 py-4 text-center"
                >
                  <p className="font-display text-xl font-extrabold text-gold-warm">
                    {t.nom}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}

        {(phase === "coup-envoi-duel-question" ||
          phase === "coup-par-coup-duel-question") &&
        question ? (
          <motion.div
            key={`q-${question.id}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex w-full flex-col items-center gap-5"
          >
            {chosenThemeNom && (
              <span className="rounded-full bg-buzz/20 px-4 py-1 text-sm font-bold uppercase tracking-widest text-buzz">
                Thème : {chosenThemeNom}
              </span>
            )}
            <h3 className="text-center font-display text-2xl font-extrabold text-foreground lg:text-4xl">
              {question.enonce}
            </h3>
            <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
              {question.choices.map((c) => (
                <div
                  key={c.idx}
                  className="flex items-center gap-3 rounded-xl border-2 border-buzz/30 bg-card px-4 py-3 text-base font-semibold text-foreground"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-buzz/15 font-display text-sm font-extrabold text-buzz">
                    {String.fromCharCode(65 + c.idx)}
                  </span>
                  <span className="flex-1">{c.text}</span>
                </div>
              ))}
            </div>
            {candidate && (
              <p className="text-base font-bold text-foreground/70">
                <span className="text-buzz">{candidate.pseudo}</span>, à toi de
                répondre !
              </p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function DuelistCard({
  player,
  role,
}: {
  player: DcPlayer;
  role: "Challenger" | "Candidat";
}) {
  const tone =
    role === "Challenger"
      ? "border-buzz bg-buzz/10 shadow-[0_0_24px_rgba(206,31,67,0.4)]"
      : "border-gold bg-gold/10 shadow-[0_0_24px_rgba(245,183,0,0.4)]";
  const labelTone = role === "Challenger" ? "text-buzz" : "text-gold-warm";
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-3xl border-2 p-5 text-center ${tone}`}
    >
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.3em] ${labelTone}`}
      >
        {role}
      </span>
      <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl bg-foreground/10 sm:h-28 sm:w-28">
        {player.avatarUrl ? (
          <Image
            src={player.avatarUrl}
            alt=""
            width={112}
            height={112}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <Crown className="h-12 w-12 text-foreground/40" aria-hidden="true" />
        )}
      </div>
      <p className="font-display text-2xl font-extrabold text-foreground">
        {player.pseudo}
      </p>
    </div>
  );
}
