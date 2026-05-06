"use client";

import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Boutons de réponse A/B/C/D pour le téléphone joueur en mode TV.
 *
 * Vague W (#5) — refonte "Quizz Cards" cream/navy :
 *  - fond cream (lisible, pas agressif)
 *  - bordure navy (DA principale)
 *  - lettre A/B/C/D dans une box carrée arrondie navy à gauche
 *  - texte navy à droite, layout horizontal compact
 *  - hover lift + tap squeeze
 *  - apparition staggerée (effet "wow" au chargement)
 *  - 4 états : idle / selected / correct / incorrect
 *  - shake horizontal sur mauvaise réponse
 *
 * Avant Vague W : dégradé navy avec halo gold (Vague S5). On bascule sur
 * le style cream/navy plus DA-cohérent avec le reste de l'app.
 */

export type AnswerState = "idle" | "selected" | "correct" | "incorrect";

export interface AnswerChoice {
  idx: number;
  text: string;
}

interface AnswerButtonsProps {
  choices: AnswerChoice[];
  /** Affiche le texte des choix (mode "full" / régie). En "light", lettre seule. */
  showText: boolean;
  /** Boutons cliquables ? (false en attente, en résultat, ou pas son tour) */
  enabled: boolean;
  onAnswer: (idx: number) => void;
  /** État global pour révéler la bonne/mauvaise après réponse. */
  selectedIdx?: number | null;
  correctIdx?: number | null;
}

export function AnswerButtons({
  choices,
  showText,
  enabled,
  onAnswer,
  selectedIdx = null,
  correctIdx = null,
}: AnswerButtonsProps) {
  // Layout : 2 réponses → 2 cols ; 4 réponses → 2x2 (toujours, même desktop)
  const gridClass = choices.length <= 2 ? "grid-cols-2" : "grid-cols-2";

  return (
    <section className={cn("grid flex-1 gap-3 sm:gap-4", gridClass)}>
      {choices.map((c, i) => {
        const state = computeState(c.idx, selectedIdx, correctIdx);
        const isShake = state === "incorrect";
        return (
          <motion.button
            key={c.idx}
            type="button"
            onClick={() => enabled && onAnswer(c.idx)}
            initial={{ opacity: 0, y: 16, scale: 0.92 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              x: isShake ? [0, -6, 6, -4, 4, 0] : 0,
            }}
            transition={{
              opacity: { duration: 0.3, delay: 0.06 * i },
              y: { duration: 0.4, delay: 0.06 * i, type: "spring", stiffness: 220, damping: 18 },
              scale: { duration: 0.3, delay: 0.06 * i },
              x: { duration: 0.45 },
            }}
            whileHover={enabled ? { scale: 1.02, y: -1 } : undefined}
            whileTap={enabled ? { scale: 0.97 } : undefined}
            disabled={!enabled}
            aria-label={`Réponse ${String.fromCharCode(65 + c.idx)}${
              showText ? ` : ${c.text}` : ""
            }`}
            className={cn(
              // Vague W (#5) — Layout horizontal Quizz Card : box lettre à
              // gauche, texte à droite. col-span-full sur 2 réponses pour
              // pleine largeur (style flashcard).
              "relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border-2 p-4 sm:p-5 transition-all",
              "min-h-[88px]",
              choices.length <= 2 && "col-span-2",
              stateClasses(state),
              !enabled && state === "idle" && "opacity-60",
            )}
          >
            <span
              className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-display text-3xl font-black shadow-md sm:h-16 sm:w-16 sm:text-4xl",
                letterBgFor(state),
              )}
            >
              {String.fromCharCode(65 + c.idx)}
            </span>

            {showText ? (
              <span
                className={cn(
                  "flex-1 text-left text-base font-bold leading-snug sm:text-lg",
                  textColorFor(state),
                )}
              >
                {c.text}
              </span>
            ) : (
              <span className="flex-1" />
            )}

            {state === "correct" && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-life-green text-cream shadow">
                <Check className="h-5 w-5" aria-hidden="true" strokeWidth={3} />
              </span>
            )}
            {state === "incorrect" && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-buzz text-cream shadow">
                <X className="h-5 w-5" aria-hidden="true" strokeWidth={3} />
              </span>
            )}
          </motion.button>
        );
      })}
    </section>
  );
}

function computeState(
  idx: number,
  selectedIdx: number | null,
  correctIdx: number | null,
): AnswerState {
  if (correctIdx !== null) {
    if (idx === correctIdx) return "correct";
    if (idx === selectedIdx) return "incorrect";
    return "idle";
  }
  if (selectedIdx === idx) return "selected";
  return "idle";
}

/**
 * Vague W (#5) — Quizz Cards style cream/navy :
 *  - idle    : cream + bordure navy/30 + box lettre navy
 *  - selected: cream + bordure gold + box lettre gold
 *  - correct : life-green pâle + bordure life-green + box life-green
 *  - incorrect: buzz pâle + bordure buzz + box buzz
 */
function stateClasses(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "border-life-green bg-life-green/10 shadow-[0_4px_16px_rgba(58,164,86,0.25)]";
    case "incorrect":
      return "border-buzz bg-buzz/10 shadow-[0_4px_16px_rgba(206,31,67,0.25)]";
    case "selected":
      return "border-gold bg-gold/10 shadow-[0_4px_16px_rgba(245,183,0,0.3)]";
    case "idle":
    default:
      return "border-navy/25 bg-cream hover:border-navy/60 shadow-md hover:shadow-lg";
  }
}

function letterBgFor(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "bg-life-green text-cream";
    case "incorrect":
      return "bg-buzz text-cream";
    case "selected":
      return "bg-gold text-navy";
    case "idle":
    default:
      return "bg-navy text-cream";
  }
}

/** Couleur du texte de la réponse selon l'état (lisibilité sur fond cream). */
function textColorFor(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "text-life-green";
    case "incorrect":
      return "text-buzz";
    case "selected":
    case "idle":
    default:
      return "text-foreground";
  }
}
