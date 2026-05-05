"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isCpcQuestion,
  type CpcQuestion,
  type DcPlayer,
} from "@/lib/realtime/tv-douze-coups-state";
import { TvPlayerLifeCard } from "@/components/tv/TvPlayerLifeCard";

/**
 * Vague R — Vue TV pour l'étape "Coup par Coup". Format différent du
 * Coup d'Envoi : 1 thème, 7 propositions, le joueur courant doit
 * trouver l'intrus (la seule réponse marquée correct=false dans la BDD).
 *
 * Layout : sidebar joueurs (avec barres de vie) + grand panneau central
 * avec thème (énoncé) + 7 propositions numérotées 1..7. Indication de
 * qui doit jouer ce tour-ci.
 *
 * Les duels sont gérés par TvDuelView (commun avec Coup d'Envoi).
 */
export function TvCoupParCoupView({
  code,
  players,
  currentPlayerToken,
  question,
  /** Index choisi par le joueur courant (révélé après réponse). */
  revealedChosenIdx = null,
  /** Index de l'intrus (révélé après réponse). */
  revealedIntrusIdx = null,
}: {
  code: string;
  players: DcPlayer[];
  currentPlayerToken: string | null;
  question: CpcQuestion | null;
  revealedChosenIdx?: number | null;
  revealedIntrusIdx?: number | null;
}) {
  const currentPseudo = players.find((p) => p.token === currentPlayerToken)
    ?.pseudo;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Sidebar joueurs avec barres de vie + animations Vague S6 */}
      <aside className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-buzz">
          Coup par Coup · Partie {code}
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

      {/* Question géante : thème + 7 propositions */}
      <section className="flex flex-col items-center justify-center gap-5 rounded-3xl border border-buzz/40 bg-gradient-to-br from-cream via-card to-buzz/10 p-6 lg:p-8">
        <AnimatePresence mode="wait">
          {question && isCpcQuestion(question) ? (
            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="flex w-full flex-col items-center gap-5"
            >
              <div className="flex items-center gap-2 rounded-full bg-buzz/15 px-4 py-1">
                <Target className="h-4 w-4 text-buzz" aria-hidden="true" />
                <span className="text-sm font-bold uppercase tracking-widest text-buzz">
                  Trouve l&apos;intrus
                </span>
              </div>
              <h2 className="text-center font-display text-3xl font-extrabold text-foreground lg:text-4xl">
                {question.enonce}
              </h2>
              <div className="grid w-full max-w-3xl gap-2 sm:grid-cols-2">
                {question.propositions.map((p) => {
                  const isIntrus =
                    revealedIntrusIdx !== null && p.idx === revealedIntrusIdx;
                  const isChosen =
                    revealedChosenIdx !== null && p.idx === revealedChosenIdx;
                  const reveal =
                    revealedIntrusIdx !== null || revealedChosenIdx !== null;
                  return (
                    <div
                      key={p.idx}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-base font-semibold text-foreground transition-all",
                        !reveal && "border-buzz/30 bg-card",
                        reveal && isIntrus && "border-life-green bg-life-green/15",
                        reveal &&
                          !isIntrus &&
                          isChosen &&
                          "border-buzz bg-buzz/15",
                        reveal && !isIntrus && !isChosen && "border-border bg-card opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-display text-sm font-extrabold",
                          isIntrus
                            ? "bg-life-green/20 text-life-green"
                            : "bg-buzz/15 text-buzz",
                        )}
                      >
                        {p.idx + 1}
                      </span>
                      <span className="flex-1">{p.text}</span>
                    </div>
                  );
                })}
              </div>
              {currentPseudo && (
                <p className="text-lg font-bold text-foreground/70">
                  À toi de jouer,{" "}
                  <span className="text-buzz">{currentPseudo}</span> !
                </p>
              )}
            </motion.div>
          ) : (
            <Loader2
              className="h-12 w-12 animate-spin text-buzz"
              aria-hidden="true"
            />
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

