"use client";

import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Q2.1 — Boutons de réponse A/B (et A/B/C/D) pour le téléphone joueur en
 * mode TV (light + remote). Refonte de l'ancienne version "rouge/bleu/vert/
 * jaune verticale" qui cassait la palette navy/or et était peu lisible.
 *
 * Spécifications :
 * - Layout horizontal : 2 réponses → grid-cols-2 (côte à côte) ;
 *   4 réponses → grid-cols-2 (2x2 mobile, 4 col desktop large via lg:).
 * - Style sobre : bordure gold + fond cream, lettre "A" à gauche en grand.
 * - États visuels : idle / selected / correct (vert) / incorrect (rouge).
 * - Animation simple : scale 0.97 au tap. Pas de gradient agressif.
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
  // Layout : 2 réponses → 2 colonnes ; 4 réponses → 2x2 puis 4 col desktop large.
  const gridClass =
    choices.length <= 2
      ? "grid-cols-2"
      : "grid-cols-2 lg:grid-cols-4";

  return (
    <section className={cn("grid flex-1 gap-3", gridClass)}>
      {choices.map((c) => {
        const state = computeState(c.idx, selectedIdx, correctIdx);
        return (
          <motion.button
            key={c.idx}
            type="button"
            onClick={() => enabled && onAnswer(c.idx)}
            whileTap={enabled ? { scale: 0.97 } : undefined}
            disabled={!enabled}
            aria-label={`Réponse ${String.fromCharCode(65 + c.idx)}${
              showText ? ` : ${c.text}` : ""
            }`}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 p-4 text-foreground transition-all",
              "min-h-[120px]",
              stateClasses(state),
              !enabled && "opacity-50",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-2xl font-display text-3xl font-black",
                  letterBgFor(state),
                )}
              >
                {String.fromCharCode(65 + c.idx)}
              </span>
              {state === "correct" && (
                <Check className="h-6 w-6 text-life-green" aria-hidden="true" />
              )}
              {state === "incorrect" && (
                <X className="h-6 w-6 text-buzz" aria-hidden="true" />
              )}
            </div>
            {showText && (
              <span className="text-center text-sm font-semibold normal-case leading-tight">
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

function stateClasses(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "border-life-green bg-life-green/10 shadow-[0_0_24px_rgba(58,164,86,0.35)]";
    case "incorrect":
      return "border-buzz bg-buzz/10 shadow-[0_0_24px_rgba(206,31,67,0.35)]";
    case "selected":
      return "border-gold bg-gold/15 shadow-[0_0_24px_rgba(245,183,0,0.35)]";
    case "idle":
    default:
      return "border-gold/50 bg-cream hover:border-gold hover:bg-gold/5 active:bg-gold/10";
  }
}

function letterBgFor(state: AnswerState): string {
  switch (state) {
    case "correct":
      return "bg-life-green/20 text-life-green";
    case "incorrect":
      return "bg-buzz/20 text-buzz";
    case "selected":
      return "bg-gold/30 text-gold-warm";
    case "idle":
    default:
      return "bg-gold/15 text-gold-warm";
  }
}
