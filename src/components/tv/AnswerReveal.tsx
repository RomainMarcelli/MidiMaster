"use client";

import { motion } from "framer-motion";
import { Check, Lightbulb, X } from "lucide-react";
import { resolveCorrectAnswerLabel } from "@/lib/game-logic/answer-display";
import { cn } from "@/lib/utils";

/**
 * Vague S7 — Bannière pédagogique affichée après une mauvaise réponse.
 *
 * Au-delà du surlignage vert/rouge dans `AnswerButtons`, on affiche
 * explicitement :
 *  - "La bonne réponse était : **X**" (en gros)
 *  - L'explication BDD si présente (avec icône ampoule)
 *
 * Vague W (#8) — Si `correctText` est un label générique ("L'autre", "Vrai",
 * "L'un"...), on l'enrichit via `resolveCorrectAnswerLabel` qui extrait un
 * libellé informatif depuis l'explication. Sinon le téléphone affichait
 * "La bonne réponse était : L'autre" — confusant.
 *
 * Composant purement présentationnel : pas de timer interne, c'est le
 * caller qui décide quand le démonter (généralement après ~3-4 s).
 */
export function AnswerReveal({
  isCorrect,
  isMine,
  correctText,
  chosenText,
  explication,
  cpcMode = false,
  byPseudo,
}: {
  isCorrect: boolean;
  /** True si c'est l'utilisateur courant qui a répondu (sinon spectateur). */
  isMine: boolean;
  /** Texte de la bonne réponse / proposition correcte. */
  correctText: string;
  /** Texte de la réponse choisie par le joueur (pour récap). Optionnel. */
  chosenText?: string | null;
  /** Explication pédagogique de la BDD. Optionnel. */
  explication?: string | null;
  /** True pour le format Coup par Coup (intrus). Adapte le wording. */
  cpcMode?: boolean;
  /**
   * Vague V (#6) — Pseudo du joueur qui a répondu (si !isMine). Utilisé
   * pour personnaliser l'affichage côté spectateur : "[Pseudo] a bien
   * répondu" plutôt que "Bonne réponse" générique.
   */
  byPseudo?: string;
}) {
  // Vague W (#8) — Enrichit `correctText` si c'est un label générique
  // ("L'autre", "Vrai"...). Le helper extrait un libellé depuis l'explication.
  const displayCorrect = resolveCorrectAnswerLabel(correctText, explication) ?? correctText;

  if (isCorrect) {
    const titleMine = cpcMode ? "Bien joué — c'était l'intrus !" : "Bonne réponse !";
    const titleOther = byPseudo
      ? cpcMode
        ? `${byPseudo} a trouvé l'intrus`
        : `${byPseudo} a bien répondu`
      : "Bonne réponse";
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 rounded-2xl border-2 border-life-green bg-life-green/10 p-4 text-left"
        role="status"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-life-green text-cream shadow">
          <Check className="h-5 w-5" aria-hidden="true" strokeWidth={3} />
        </span>
        <div className="flex-1">
          <p className="font-display text-base font-extrabold text-life-green">
            {isMine ? titleMine : titleOther}
          </p>
          {!isMine && displayCorrect && (
            <p className="mt-0.5 text-sm text-foreground/70">
              {cpcMode ? "L'intrus" : "Réponse"} :{" "}
              <span className="font-semibold text-foreground">{displayCorrect}</span>
            </p>
          )}
          {explication && <ExplicationLine text={explication} tone="green" />}
        </div>
      </motion.div>
    );
  }

  const titleMine = cpcMode ? "Raté — ce n'était pas l'intrus" : "Mauvaise réponse";
  const titleOther = byPseudo
    ? cpcMode
      ? `${byPseudo} s'est fait avoir par l'intrus`
      : `${byPseudo} s'est trompé`
    : "Loupé";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3 rounded-2xl border-2 border-buzz bg-buzz/10 p-4 text-left"
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-buzz text-cream shadow">
          <X className="h-5 w-5" aria-hidden="true" strokeWidth={3} />
        </span>
        <div className="flex-1">
          <p className="font-display text-base font-extrabold text-buzz">
            {isMine ? titleMine : titleOther}
          </p>
          {chosenText && isMine && (
            <p className="mt-0.5 text-sm text-foreground/70">
              Tu as répondu :{" "}
              <span className="font-semibold text-foreground line-through">
                {chosenText}
              </span>
            </p>
          )}
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-life-green/40 bg-life-green/5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-life-green/20 text-life-green">
          <Check className="h-4 w-4" aria-hidden="true" strokeWidth={3} />
        </span>
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-life-green">
            {cpcMode ? "L'intrus était" : "La bonne réponse était"}
          </p>
          <p className="mt-0.5 font-display text-base font-extrabold text-foreground">
            {displayCorrect}
          </p>
        </div>
      </div>
      {explication && <ExplicationLine text={explication} tone="green" />}
    </motion.div>
  );
}

function ExplicationLine({
  text,
  tone,
}: {
  text: string;
  tone: "green" | "neutral";
}) {
  return (
    <p
      className={cn(
        "mt-2 flex items-start gap-2 text-sm font-medium",
        tone === "green" ? "text-life-green" : "text-foreground/80",
      )}
    >
      <Lightbulb
        className="mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
        fill="currentColor"
      />
      <span className="text-foreground/85">{text}</span>
    </p>
  );
}
