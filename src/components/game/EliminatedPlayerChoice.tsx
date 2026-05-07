"use client";

import { motion } from "framer-motion";
import { Eye, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Vague X (#7) — Écran de choix proposé au joueur éliminé.
 *
 * Quand un joueur est éliminé en CE ou CPC, on lui propose 2 options
 * pour la suite :
 *  - **Suivre la partie** : reste dans la vue spectateur Realtime, voit
 *    les questions et résultats des autres joueurs sur son téléphone.
 *  - **S'entraîner** : bascule sur un quiz d'entrainement infini
 *    (`<TrainingQuizz />`) pendant que la partie continue. Le joueur
 *    pourra revenir voir le podium à la fin (le composant parent gère
 *    la transition automatique vers le podium).
 *
 * Composant purement présentationnel : prend `pseudo` + 2 callbacks.
 * Le parent (play-douze-coups-view.tsx) gère le state et la suite.
 */
export interface EliminatedPlayerChoiceProps {
  pseudo: string;
  onSpectate: () => void;
  onTrain: () => void;
}

export function EliminatedPlayerChoice({
  pseudo,
  onSpectate,
  onTrain,
}: EliminatedPlayerChoiceProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col items-center gap-2"
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-buzz">
          Tu as été éliminé
        </p>
        <h1 className="font-display text-3xl font-extrabold text-foreground">
          {pseudo}
        </h1>
      </motion.div>

      <p className="max-w-xs text-sm text-foreground/70">
        Que veux-tu faire en attendant la fin de la partie&nbsp;?
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button
          variant="default"
          size="lg"
          onClick={onSpectate}
          className="w-full"
        >
          <Eye className="size-5" aria-hidden="true" />
          Suivre la partie
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={onTrain}
          className="w-full"
        >
          <Sparkles className="size-5" aria-hidden="true" />
          S&apos;entraîner en attendant
        </Button>
      </div>

      <p className="mt-2 max-w-xs text-xs text-foreground/50">
        Tu pourras revenir voir le podium à la fin de la partie.
      </p>
    </main>
  );
}
