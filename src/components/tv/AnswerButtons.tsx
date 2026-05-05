"use client";

import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Boutons de réponse A/B/C/D pour le téléphone joueur en mode TV.
 *
 * Vague S5 — refonte "jeu mobile premium" :
 *  - dégradé navy avec bordure gold + halo
 *  - lettre A/B/C/D dans une box ronde dorée à gauche
 *  - texte cream gros et lisible
 *  - hover lift + tap squeeze
 *  - apparition staggerée (effet "wow" au chargement)
 *  - 4 états : idle / selected / correct / incorrect
 *  - shake horizontal sur mauvaise réponse
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
            whileHover={enabled ? { scale: 1.03, y: -2 } : undefined}
            whileTap={enabled ? { scale: 0.96 } : undefined}
            disabled={!enabled}
            aria-label={`Réponse ${String.fromCharCode(65 + c.idx)}${
              showText ? ` : ${c.text}` : ""
            }`}
            className={cn(
              "relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border-2 p-5 sm:p-6 transition-all",
              "min-h-[140px]",
              stateClasses(state),
              !enabled && state === "idle" && "opacity-50",
            )}
          >
            {/* Halo doré pulsant en idle (pour appeler le clic) */}
            {state === "idle" && enabled && (
              <motion.div
                className="pointer-events-none absolute inset-0 rounded-3xl"
                style={{ boxShadow: "inset 0 0 32px rgba(245,183,0,0.15)" }}
                animate={{ opacity: [0.4, 0.85, 0.4] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                aria-hidden="true"
              />
            )}

            <div className="relative z-10 flex w-full items-center justify-between gap-3">
              <span
                className={cn(
                  "flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-display text-3xl font-black shadow-md sm:h-16 sm:w-16 sm:text-4xl",
                  letterBgFor(state),
                )}
              >
                {String.fromCharCode(65 + c.idx)}
              </span>
              {state === "correct" && (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-life-green text-cream shadow-lg">
                  <Check className="h-6 w-6" aria-hidden="true" strokeWidth={3} />
                </span>
              )}
              {state === "incorrect" && (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-buzz text-cream shadow-lg">
                  <X className="h-6 w-6" aria-hidden="true" strokeWidth={3} />
                </span>
              )}
            </div>

            {showText && (
              <span
                className={cn(
                  "relative z-10 w-full text-center text-base font-bold leading-tight sm:text-lg",
                  textColorFor(state),
                )}
              >
                {c.text}
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
 * Classe Tailwind pour l'état du bouton. Style premium :
 *  - idle    : dégradé navy + bordure gold + ombre profonde
 *  - selected: dégradé gold + bordure gold épaisse
 *  - correct : dégradé life-green + bordure life-green
 *  - incorrect: dégradé buzz + bordure buzz
 */
function stateClasses(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "border-life-green bg-gradient-to-br from-life-green/20 via-life-green/15 to-life-green/25 shadow-[0_8px_32px_rgba(58,164,86,0.4)]";
    case "incorrect":
      return "border-buzz bg-gradient-to-br from-buzz/20 via-buzz/15 to-buzz/30 shadow-[0_8px_32px_rgba(206,31,67,0.4)]";
    case "selected":
      return "border-gold bg-gradient-to-br from-gold/30 via-gold-pale to-gold/40 shadow-[0_8px_32px_rgba(245,183,0,0.5)]";
    case "idle":
    default:
      return "border-gold bg-gradient-to-br from-navy via-navy-soft to-navy hover:from-navy-soft hover:via-navy-soft hover:to-navy shadow-[0_8px_28px_rgba(11,31,77,0.5)] hover:shadow-[0_12px_40px_rgba(245,183,0,0.4)]";
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
      return "bg-gold text-navy";
  }
}

/** Couleur du texte de la réponse selon l'état (lisibilité sur fond). */
function textColorFor(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "text-life-green";
    case "incorrect":
      return "text-buzz";
    case "selected":
      return "text-foreground";
    case "idle":
    default:
      return "text-cream";
  }
}
