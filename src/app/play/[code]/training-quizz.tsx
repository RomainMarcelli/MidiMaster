"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { AnswerButtons } from "@/components/tv/AnswerButtons";
import { AnswerReveal } from "@/components/tv/AnswerReveal";
import {
  getRandomTrainingQuestion,
  type TrainingQuestion,
} from "@/lib/training/get-random-question";

/**
 * Vague V (#2) — Quiz d'entrainement infini sur le telephone du joueur
 * pendant l'attente de la partie (entre "rejoint la room" et "1ere
 * question reelle"). Aucun impact sur le score de la partie reelle.
 *
 * Cycle :
 *  - "loading"       : fetch d'une question random
 *  - "answering"     : boutons cliquables, attente du clic
 *  - "showing-result": affichage de la bonne reponse + explication, auto-load
 *                      apres 4s OU clic sur "Question suivante"
 *
 * Si fetch echoue (BDD vide, reseau), retry automatique apres 2s.
 */
type State = "loading" | "answering" | "showing-result";

const AUTO_NEXT_MS = 4000;
const RETRY_MS = 2000;

export function TrainingQuizz() {
  const [state, setState] = useState<State>("loading");
  const [question, setQuestion] = useState<TrainingQuestion | null>(null);
  const [chosenIdx, setChosenIdx] = useState<number | null>(null);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup du timer en cas de demount (sinon on tente un setState apres unmount).
  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  async function loadNext() {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setState("loading");
    setChosenIdx(null);
    try {
      const q = await getRandomTrainingQuestion();
      setQuestion(q);
      setState("answering");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[training] failed to load question, retry in 2s", e);
      autoNextTimerRef.current = setTimeout(() => {
        void loadNext();
      }, RETRY_MS);
    }
  }

  // Initial load
  useEffect(() => {
    void loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAnswer(idx: number) {
    if (state !== "answering") return;
    setChosenIdx(idx);
    setState("showing-result");
    autoNextTimerRef.current = setTimeout(() => {
      void loadNext();
    }, AUTO_NEXT_MS);
  }

  if (state === "loading" || !question) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-foreground/60">
        <Loader2 className="h-8 w-8 animate-spin text-gold-warm" aria-hidden="true" />
        <p>Chargement d&apos;une question d&apos;entraînement…</p>
      </section>
    );
  }

  const correctIdx = question.choices.findIndex((c) => c.correct);
  const correctChoice = question.choices.find((c) => c.correct);
  const chosenChoice =
    chosenIdx !== null
      ? question.choices.find((c) => c.idx === chosenIdx)
      : null;
  const isCorrect = chosenIdx !== null && chosenIdx === correctIdx;

  return (
    <section className="flex flex-1 flex-col gap-4">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 self-start rounded-full border border-sky/40 bg-sky/10 px-4 py-1.5 text-sm font-bold text-sky"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <span>Entraînement — en attendant la partie</span>
      </motion.div>

      <p className="rounded-2xl border border-border bg-card p-4 text-center font-display text-base font-bold text-foreground">
        {question.enonce}
      </p>

      <AnswerButtons
        choices={question.choices.map((c) => ({ idx: c.idx, text: c.text }))}
        showText
        enabled={state === "answering"}
        onAnswer={handleAnswer}
        selectedIdx={chosenIdx}
        correctIdx={state === "showing-result" ? correctIdx : null}
      />

      {state === "showing-result" && correctChoice && (
        <AnswerReveal
          isCorrect={isCorrect}
          isMine
          correctText={correctChoice.text}
          chosenText={chosenChoice?.text ?? null}
          explication={question.explication}
        />
      )}

      {state === "showing-result" && (
        <Button
          variant="outline"
          onClick={() => {
            void loadNext();
          }}
          className="w-full"
        >
          Question suivante
        </Button>
      )}
    </section>
  );
}
