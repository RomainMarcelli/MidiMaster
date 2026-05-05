"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
  isQuizzQuestion,
  type DcPlayer,
  type QuizzQuestion,
} from "@/lib/realtime/tv-douze-coups-state";
import { TvPlayerLifeCard } from "@/components/tv/TvPlayerLifeCard";

/**
 * Vague R — Vue TV pour l'étape "Coup d'Envoi" (questions quizz_4 tour
 * par tour). Affichage : sidebar 4 joueurs avec état de vie, question
 * géante au centre + indication "À toi de jouer, [pseudo]".
 *
 * Vague S6 — la sidebar utilise désormais le composant
 * `TvPlayerLifeCard` qui gère l'animation flash sur perte de vie et
 * l'overlay "éliminé".
 *
 * En cas de duel ou de transition entre tours, c'est une autre vue qui
 * prend le relais (TvDuelView, EliminationOverlay).
 */
export function TvCoupEnvoiView({
  code,
  players,
  currentPlayerToken,
  question,
}: {
  code: string;
  players: DcPlayer[];
  currentPlayerToken: string | null;
  question: QuizzQuestion | null;
}) {
  const currentPseudo = players.find((p) => p.token === currentPlayerToken)
    ?.pseudo;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Sidebar joueurs avec barres de vie + animations Vague S6 */}
      <aside className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
          Coup d&apos;Envoi · Partie {code}
        </p>
        {players.map((p) => (
          <TvPlayerLifeCard
            key={p.token}
            player={p}
            isCurrent={p.token === currentPlayerToken}
            size="sm"
          />
        ))}
      </aside>

      {/* Question géante */}
      <section className="flex flex-col items-center justify-center gap-6 rounded-3xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-8 text-center glow-sun lg:p-10">
        <AnimatePresence mode="wait">
          {question && isQuizzQuestion(question) ? (
            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="flex w-full flex-col items-center gap-6"
            >
              {question.format && (
                <span className="rounded-full bg-gold/20 px-4 py-1 text-sm font-bold uppercase tracking-widest text-gold-warm">
                  {question.format}
                </span>
              )}
              <h2 className="font-display text-3xl font-extrabold text-foreground lg:text-5xl">
                {question.enonce}
              </h2>
              <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
                {question.choices.map((c) => (
                  <div
                    key={c.idx}
                    className="flex items-center gap-3 rounded-xl border-2 border-gold/30 bg-card px-6 py-5 text-left text-xl font-semibold text-foreground"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/20 font-display font-extrabold text-gold-warm">
                      {String.fromCharCode(65 + c.idx)}
                    </span>
                    <span className="flex-1">{c.text}</span>
                  </div>
                ))}
              </div>
              {currentPseudo && (
                <p className="text-lg font-bold text-foreground/70">
                  À toi de jouer,{" "}
                  <span className="text-gold-warm">{currentPseudo}</span> !
                </p>
              )}
            </motion.div>
          ) : (
            <Loader2
              className="h-12 w-12 animate-spin text-gold-warm"
              aria-hidden="true"
            />
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
