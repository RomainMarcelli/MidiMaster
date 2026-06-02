"use client";

import { useContext, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Clock,
  Home,
  RefreshCw,
  RotateCcw,
  Send,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnswerButton } from "@/components/game/AnswerButton";
import { FavoriteStar } from "@/components/game/FavoriteStar";
import { SpeakerButton } from "@/components/game/SpeakerButton";
import { Button } from "@/components/ui/button";
import {
  isGenericChoiceLabel,
  resolveCorrectAnswerLabel,
} from "@/lib/game-logic/answer-display";
import { isMatch } from "@/lib/matching/fuzzy-match";
import { buildTTSFeedbackText, useAutoPlayTTS } from "@/lib/tts-helpers";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import type { RevQuestion } from "@/lib/revision/types";
import { markRevisionResult } from "../actions";
import { FavoriteIdsContext } from "./favorite-ids-context";
import { useReviewBatcher } from "./review-batcher-context";

interface QuizPlayerProps {
  questions: RevQuestion[];
  /** Callback de fin de session. */
  onDone?: (stats: { correct: number; wrong: number }) => void;
  /** Si true (défaut), une mauvaise réponse réécrit dans wrong_answers via markRevisionResult. */
  trackWrong?: boolean;
  /**
   * H1.4 — Si true, une bonne réponse retire IMMÉDIATEMENT la ligne
   * de wrong_answers (au lieu d'incrémenter success_streak avec un
   * seuil à 3). Réservé au mode "Refaire mes erreurs" pour que le
   * compteur d'erreurs décroisse en temps réel et que l'utilisateur
   * puisse quitter avant la fin sans perdre le crédit.
   */
  removeOnCorrect?: boolean;
  /**
   * I1.5 — IDs des questions déjà favorites pour le user. L'étoile
   * s'affiche remplie pour ces questions. Si non fourni, toutes les
   * étoiles partent vides (état initial).
   *
   * Sur la page Favoris, on passe l'ensemble complet des IDs (puisque
   * toutes les questions sont favorites par définition).
   */
  favoriteIds?: ReadonlySet<string>;
  /**
   * Affiche un bouton "Re-tirer la liste" sur la 1ère question uniquement
   * (tant que l'utilisateur n'a pas répondu). Pratique en Marathon libre
   * pour relancer un tirage si la première question tombée a déjà été vue
   * dans une session récente.
   */
  onReshuffle?: () => void;
  /** Si true, le bouton "Re-tirer" est en cours de chargement (disabled + label). */
  isReshuffling?: boolean;
}

type Phase =
  | { kind: "playing"; idx: number; correct: number; wrong: number }
  | { kind: "done"; correct: number; wrong: number };

export function QuizPlayer({
  questions,
  onDone,
  trackWrong = true,
  removeOnCorrect = false,
  favoriteIds,
  onReshuffle,
  isReshuffling = false,
}: QuizPlayerProps) {
  // I1.5 — Fallback sur le contexte si la prop n'est pas passée. Permet
  // aux modes (Marathon, Apprendre…) de bénéficier des étoiles remplies
  // sans devoir prop-driller le Set à chaque appel.
  const ctxFavoriteIds = useContext(FavoriteIdsContext);
  const effectiveFavoriteIds = favoriteIds ?? ctxFavoriteIds;
  // J1.2 — File des "à marquer révisé" remontée au niveau de
  // RevisionClient (via contexte). Permet au bouton "Retour aux modes"
  // de flusher avant navigation, et centralise les listeners
  // beforeunload/pagehide pour qu'ils survivent au démontage de
  // QuizPlayer.
  const reviewBatcher = useReviewBatcher();
  const [phase, setPhase] = useState<Phase>({
    kind: "playing",
    idx: 0,
    correct: 0,
    wrong: 0,
  });

  // E2.3 — Tracking du temps de session pour afficher temps total +
  // moyenne par question dans le DoneScreen. Set à chaque (re)démarrage.
  const sessionStartedAtRef = useRef<number>(Date.now());
  const sessionEndedAtRef = useRef<number | null>(null);

  if (phase.kind === "done") {
    const totalMs =
      (sessionEndedAtRef.current ?? Date.now()) - sessionStartedAtRef.current;
    return (
      <DoneScreen
        correct={phase.correct}
        wrong={phase.wrong}
        total={questions.length}
        totalMs={totalMs}
        onRestart={() => {
          sessionStartedAtRef.current = Date.now();
          sessionEndedAtRef.current = null;
          setPhase({ kind: "playing", idx: 0, correct: 0, wrong: 0 });
        }}
      />
    );
  }

  const q = questions[phase.idx];
  if (!q) {
    sessionEndedAtRef.current = Date.now();
    onDone?.({ correct: phase.correct, wrong: phase.wrong });
    setPhase({ kind: "done", correct: phase.correct, wrong: phase.wrong });
    return null;
  }

  return (
    <PlayCard
      key={q.questionId}
      question={q}
      index={phase.idx}
      total={questions.length}
      trackWrong={trackWrong}
      removeOnCorrect={removeOnCorrect}
      isFavorite={effectiveFavoriteIds.has(q.questionId)}
      onReshuffle={phase.idx === 0 ? onReshuffle : undefined}
      isReshuffling={isReshuffling}
      onCorrectForReview={(questionId) => {
        // I1.3 + J1.2 — Bonne réponse en mode Refaire : on stocke dans
        // la file partagée (au niveau RevisionClient). Pas de DELETE
        // BDD ici. Le flush arrive au clic Suivant (onDone) ou au
        // bouton "Retour aux modes" (parent).
        if (removeOnCorrect) reviewBatcher.addPending(questionId);
      }}
      onDone={(isCorrect) => {
        const next = phase.idx + 1;
        const correct = phase.correct + (isCorrect ? 1 : 0);
        const wrong = phase.wrong + (isCorrect ? 0 : 1);
        // I1.3 + J1.2 — Au clic "Suivant", flush les bonnes réponses
        // en attente. En pratique = la question qu'on vient de quitter
        // si elle a été correctement répondue.
        if (removeOnCorrect) reviewBatcher.flush();
        if (next >= questions.length) {
          sessionEndedAtRef.current = Date.now();
          onDone?.({ correct, wrong });
          setPhase({ kind: "done", correct, wrong });
        } else {
          setPhase({ kind: "playing", idx: next, correct, wrong });
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function PlayCard({
  question,
  index,
  total,
  trackWrong,
  removeOnCorrect,
  isFavorite,
  onCorrectForReview,
  onDone,
  onReshuffle,
  isReshuffling = false,
}: {
  question: RevQuestion;
  index: number;
  total: number;
  trackWrong: boolean;
  removeOnCorrect: boolean;
  isFavorite: boolean;
  /**
   * I1.3 — Appelé quand la question est correctement répondue ET que
   * `removeOnCorrect` est actif. Le parent stocke l'ID dans son set
   * "pending reviewed" sans toucher à la BDD ; le DELETE est différé
   * au clic "Suivant" / fin de quizz / beforeunload.
   */
  onCorrectForReview: (questionId: string) => void;
  onDone: (isCorrect: boolean) => void;
  /** Présent uniquement sur la 1ère question si le parent veut autoriser un retirage. */
  onReshuffle?: () => void;
  isReshuffling?: boolean;
}) {
  const [feedback, setFeedback] = useState<
    | null
    | {
        kind: "correct" | "wrong";
        correctText: string;
      }
  >(null);
  const [, startTransition] = useTransition();
  // E1.3 — Timestamp du moment où le feedback a été affiché. Sert à
  // ignorer les Entrée arrivant moins de 300 ms après, pour éviter
  // qu'un même appui valide ET passe à la suivante en un seul coup
  // (bug observé en Marathon libre).
  const feedbackSetAtRef = useRef<number>(0);

  // Lecture auto TTS : énoncé + choix (si quizz_2/4) au mount, puis
  // feedback complet quand l'utilisateur a répondu.
  const ttsFeedback = feedback
    ? buildTTSFeedbackText({
        isCorrect: feedback.kind === "correct",
        correctLabel:
          feedback.kind === "wrong"
            ? resolveCorrectAnswerLabel(
                feedback.correctText,
                question.explication,
              )
            : null,
        explanation: question.explication,
      })
    : null;
  useAutoPlayTTS({
    enonce: question.enonce,
    choices:
      question.type === "quizz_2" || question.type === "quizz_4"
        ? question.reponses.map((r) => r.text)
        : undefined,
    feedbackText: ttsFeedback,
  });

  function record(isCorrect: boolean, correctText: string) {
    if (feedback) return;
    if (isCorrect) playSound("ding");
    else playSound("buzz");
    feedbackSetAtRef.current = Date.now();
    setFeedback({ kind: isCorrect ? "correct" : "wrong", correctText });
    if (trackWrong) {
      // I1.3 — En mode "Refaire mes erreurs", la bonne réponse n'est
      // PLUS supprimée immédiatement : on prévient le parent qu'elle
      // peut être marquée révisée, mais le DELETE BDD est différé
      // jusqu'au clic "Suivant" (ou fin de quizz / beforeunload).
      // Une mauvaise réponse passe toujours par markRevisionResult
      // (qui réincrémente fail_count).
      if (removeOnCorrect && isCorrect) {
        onCorrectForReview(question.questionId);
      } else {
        startTransition(async () => {
          await markRevisionResult(question.questionId, isCorrect);
        });
      }
    }
  }

  // Quand le feedback est affiché, la touche Entrée doit déclencher
  // "Passer à la suivante" (équivalent du clic bouton "Suivante").
  // On évite le double-handling si le focus est encore dans l'input
  // de saisie de réponse (TextStage).
  useEffect(() => {
    if (!feedback) return;
    const fb = feedback; // capture pour TS narrowing dans le handler
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (e.repeat) return;
      // E1.3 — Anti double-fire : si feedback vient juste d'apparaître
      // (< 300 ms), on ignore l'Entrée. Évite qu'un appui Entrée qui
      // valide la réponse ne déclenche aussi le passage à la suivante.
      if (Date.now() - feedbackSetAtRef.current < 300) return;
      // Si l'utilisateur tape encore dans un input/textarea, on n'intercepte
      // pas (Entrée a alors d'autres usages comme valider la saisie).
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      onDone(fb.kind === "correct");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feedback, onDone]);

  const progress = Math.round(((index + 1) / total) * 100);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-4 sm:p-6">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-foreground/60">
          {index + 1} / {total}
        </p>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full bg-gold transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        {onReshuffle && !feedback && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReshuffle}
            disabled={isReshuffling}
            className="shrink-0 text-xs"
            title="Tirer une nouvelle liste de questions"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isReshuffling && "animate-spin")} aria-hidden="true" />
            {isReshuffling ? "Tirage…" : "Re-tirer"}
          </Button>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {question.category && (
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-on-color"
              style={{ backgroundColor: question.category.couleur ?? "#F5B700" }}
            >
              {question.category.nom}
            </span>
          )}
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-bold text-foreground/60">
            Difficulté {question.difficulte}
          </span>
        </div>
        <FavoriteStar questionId={question.questionId} initial={isFavorite} />
      </div>

      {/* Énoncé */}
      <div className="rounded-2xl border border-border bg-card p-5 glow-card">
        <h2 className="font-display text-xl font-extrabold text-foreground sm:text-2xl">
          {question.enonce}
        </h2>
      </div>
      <div className="flex justify-center">
        <SpeakerButton
          text={question.enonce}
          choices={
            question.type === "quizz_2" || question.type === "quizz_4"
              ? question.reponses.map((r) => r.text)
              : undefined
          }
          explanation={
            feedback?.kind === "wrong" ? question.explication : undefined
          }
          autoPlay={false}
        />
      </div>

      {/* UI selon le type */}
      {question.type === "quizz_2" || question.type === "quizz_4" ? (
        <ChoiceStage
          reponses={question.reponses}
          disabled={feedback !== null}
          onAnswer={(idx) => {
            const r = question.reponses[idx];
            const correct = r?.correct === true;
            const correctText = firstCorrectText(question.reponses);
            record(correct, correctText);
          }}
          feedback={feedback}
        />
      ) : (
        <TextStage
          disabled={feedback !== null}
          onAnswer={(val) =>
            record(
              isMatch(val, question.bonneReponse, question.alias),
              question.bonneReponse,
            )
          }
          bonneReponse={question.bonneReponse}
          feedback={feedback}
        />
      )}

      {/* Feedback + Continue */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "rounded-xl border p-4",
              feedback.kind === "correct"
                ? "border-life-green/40 bg-life-green/10"
                : "border-buzz/40 bg-buzz/10",
            )}
          >
            <p
              className={cn(
                "font-display font-bold",
                feedback.kind === "correct" ? "text-life-green" : "text-buzz",
              )}
            >
              {feedback.kind === "correct"
                ? "Bonne réponse"
                : "Mauvaise réponse"}
            </p>
            {feedback.kind === "wrong" &&
              (() => {
                const label = resolveCorrectAnswerLabel(
                  feedback.correctText,
                  question.explication,
                );
                return label ? (
                  <p className="mt-1 text-foreground">
                    La bonne réponse&nbsp;:{" "}
                    <strong className="text-life-green">{label}</strong>
                  </p>
                ) : null;
              })()}
            {/* E2.1 — Sur une bonne réponse à libellé générique
                (« L'un », « Vrai », …), on affiche la résolution
                « L'un = La France » pour que l'utilisateur sache à
                quoi correspondait son choix. */}
            {feedback.kind === "correct" &&
              isGenericChoiceLabel(feedback.correctText) &&
              (() => {
                const label = resolveCorrectAnswerLabel(
                  feedback.correctText,
                  question.explication,
                );
                return label ? (
                  <p className="mt-1 text-foreground">
                    {feedback.correctText}{" "}
                    <span className="text-foreground/50">=</span>{" "}
                    <strong className="text-life-green">{label}</strong>
                  </p>
                ) : null;
              })()}
            {question.explication && (
              <p
                className={cn(
                  "text-sm",
                  feedback.kind === "wrong" &&
                    !resolveCorrectAnswerLabel(
                      feedback.correctText,
                      question.explication,
                    )
                    ? "mt-1 font-semibold text-foreground"
                    : "mt-2 text-foreground/70",
                )}
              >
                {question.explication}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                variant="gold"
                size="sm"
                onClick={() => onDone(feedback.kind === "correct")}
              >
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
                {index + 1 < total ? "Suivante" : "Terminer"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function firstCorrectText(reponses: { text: string; correct: boolean }[]): string {
  return reponses.find((r) => r.correct)?.text ?? "—";
}

function ChoiceStage({
  reponses,
  disabled,
  onAnswer,
  feedback,
}: {
  reponses: { text: string; correct: boolean }[];
  disabled: boolean;
  onAnswer: (idx: number) => void;
  feedback: { kind: "correct" | "wrong"; correctText: string } | null;
}) {
  const correctIdx = reponses.findIndex((r) => r.correct);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {reponses.map((r, idx) => {
        let state: "idle" | "correct" | "wrong" = "idle";
        if (feedback && idx === correctIdx) state = "correct";
        return (
          <AnswerButton
            key={idx}
            state={state}
            disabled={disabled}
            onClick={() => onAnswer(idx)}
          >
            {r.text}
          </AnswerButton>
        );
      })}
    </div>
  );
}

function TextStage({
  disabled,
  onAnswer,
  bonneReponse,
  feedback,
}: {
  disabled: boolean;
  onAnswer: (value: string) => void;
  bonneReponse: string;
  feedback: { kind: "correct" | "wrong"; correctText: string } | null;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-stretch gap-2">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim() && !disabled) {
            // E1.3 — stopPropagation pour empêcher le même Enter de
            // remonter jusqu'au listener global "passer à la suivante".
            e.preventDefault();
            e.stopPropagation();
            onAnswer(val.trim());
          }
        }}
        placeholder={feedback ? bonneReponse : "Ta réponse…"}
        disabled={disabled}
        autoFocus
        className="h-11 flex-1 rounded-md border border-border bg-card px-3 text-base text-foreground placeholder-foreground/40 focus:border-gold focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => onAnswer(val.trim())}
        disabled={disabled || val.trim() === ""}
        className="flex h-11 items-center gap-1.5 rounded-md bg-gold px-4 font-bold text-on-color shadow-[0_4px_0_0_#e89e00] transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        Valider
      </button>
    </div>
  );
}

/**
 * Écran de fin de session — refonte E2.3.
 *
 * Au-delà du score brut, on offre :
 *   - Un titre dynamique adapté au pourcentage.
 *   - Un cercle de progression animé (1.5 s) avec le pourcentage au centre.
 *   - 4 stats détaillées : bonnes, erreurs, temps total, temps moyen.
 *   - Confettis dorés si score ≥ 80 %.
 *   - 3 boutons d'action : Recommencer (gold), Voir mes erreurs (vers
 *     /revision où l'user choisit « Retravailler »), Retour à l'accueil.
 */
function DoneScreen({
  correct,
  wrong,
  total,
  totalMs,
  onRestart,
}: {
  correct: number;
  wrong: number;
  total: number;
  totalMs: number;
  onRestart: () => void;
}) {
  const router = useRouter();
  const ratio = total > 0 ? Math.round((correct / total) * 100) : 0;
  const totalSec = Math.max(1, Math.round(totalMs / 1000));
  const avgSec = total > 0 ? Math.round(totalSec / total) : 0;

  const title =
    ratio === 100
      ? { icon: Trophy, text: "Session parfaite !", glow: true }
      : ratio >= 80
        ? { icon: Trophy, text: "Excellent travail !", glow: true }
        : ratio >= 60
          ? { icon: Check, text: "Bien joué !", glow: false }
          : { icon: Zap, text: "Continue à t'entraîner !", glow: false };

  const TitleIcon = title.icon;
  const showConfetti = ratio >= 80;

  return (
    <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 overflow-hidden p-6 text-center sm:p-8">
      {showConfetti && <SessionConfetti />}

      <motion.div
        initial={{ scale: 0.5, opacity: 0, y: -8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className={cn(
          "flex h-20 w-20 items-center justify-center rounded-3xl bg-gold/20 text-gold-warm",
          title.glow && "shadow-[0_0_64px_rgba(245,183,0,0.55)]",
        )}
      >
        <TitleIcon
          className="h-10 w-10"
          aria-hidden="true"
          fill={title.glow ? "currentColor" : "none"}
        />
      </motion.div>

      <h1 className="font-display text-3xl font-extrabold text-foreground sm:text-4xl">
        {title.text}
      </h1>

      {/* Cercle de progression animé */}
      <CircularProgress percent={ratio} />

      {/* Stats détaillées */}
      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        <StatCard
          icon={Check}
          label={`bonne${correct > 1 ? "s" : ""}`}
          value={correct.toString()}
          accent="green"
        />
        <StatCard
          icon={X}
          label={`erreur${wrong > 1 ? "s" : ""}`}
          value={wrong.toString()}
          accent="red"
        />
        <StatCard
          icon={Clock}
          label="temps total"
          value={formatDuration(totalSec)}
          accent="navy"
        />
        <StatCard
          icon={Zap}
          label="par question"
          value={`${avgSec} s`}
          accent="gold"
        />
      </div>

      {/* G1.2 — 4 actions : Recommencer / Voir mes erreurs (lecture
          seule) / Refaire mes erreurs (quizz) / Accueil. Le timestamp
          `t=` force un remount côté revision-client.tsx, qui résout
          le bug "le 2e clic ne fait rien" si on est déjà sur
          ?mode=retravailler. */}
      <div className="grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="gold" size="lg" onClick={onRestart}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Recommencer
        </Button>
        {/* Timestamp généré au clic (pas au render) → évite
            l'hydration mismatch entre SSR et client. */}
        <button
          type="button"
          onClick={() =>
            router.push(`/revision?mode=erreurs-lecture&t=${Date.now()}`)
          }
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md border-2 border-buzz/40 bg-buzz/5 px-5 text-sm font-bold text-buzz transition-all hover:scale-[1.02] hover:border-buzz hover:bg-buzz/10 hover:shadow-[0_0_20px_rgba(230,57,70,0.25)]"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Voir mes erreurs
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(`/revision?mode=retravailler&t=${Date.now()}`)
          }
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md border-2 border-buzz/40 bg-buzz/5 px-5 text-sm font-bold text-buzz transition-all hover:scale-[1.02] hover:border-buzz hover:bg-buzz/10 hover:shadow-[0_0_20px_rgba(230,57,70,0.25)]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refaire mes erreurs
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md border-2 border-gold/50 bg-card px-5 text-sm font-bold text-foreground transition-all hover:scale-[1.02] hover:border-gold hover:bg-gold/10 hover:shadow-[0_0_20px_rgba(245,183,0,0.25)]"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          Accueil
        </Link>
      </div>
    </main>
  );
}

/**
 * Cercle de progression circulaire SVG animé.
 * Anneau qui se remplit en 1.5 s avec le pourcentage au centre.
 */
function CircularProgress({ percent }: { percent: number }) {
  const size = 140;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-foreground/10"
        />
        {/* Fill animé */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          className={cn(
            percent >= 80
              ? "text-life-green"
              : percent >= 60
                ? "text-gold"
                : "text-buzz",
          )}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.p
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="font-display text-4xl font-extrabold text-foreground"
        >
          {percent}
          <span className="text-2xl">%</span>
        </motion.p>
      </div>
    </div>
  );
}

/**
 * Petite card de stat colorée pour le DoneScreen.
 */
function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  accent: "green" | "red" | "navy" | "gold";
}) {
  const accentClass = {
    green: "text-life-green border-life-green/30 bg-life-green/5",
    red: "text-buzz border-buzz/30 bg-buzz/5",
    navy: "text-foreground border-border bg-card",
    gold: "text-gold-warm border-gold/30 bg-gold/5",
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-left",
        accentClass,
      )}
    >
      <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
      <div className="flex flex-col leading-tight">
        <span className="font-display text-xl font-extrabold">{value}</span>
        <span className="text-[11px] uppercase tracking-wider text-foreground/60">
          {label}
        </span>
      </div>
    </motion.div>
  );
}

function formatDuration(totalSec: number): string {
  if (totalSec < 60) return `${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min} min` : `${min} min ${sec} s`;
}

/** Confettis dorés sur fond de session terminée (≥ 80 %). */
function SessionConfetti() {
  const count = 18;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {Array.from({ length: count }).map((_, i) => {
        const left = ((i * 11) % 100) + (i % 3) * 2;
        const delay = (i % 6) * 0.1;
        const duration = 2.6 + (i % 4) * 0.3;
        const color =
          i % 4 === 0
            ? "bg-gold"
            : i % 4 === 1
              ? "bg-gold-warm"
              : i % 4 === 2
                ? "bg-life-green"
                : "bg-sky";
        return (
          <motion.span
            key={i}
            className={cn("absolute h-2.5 w-1.5 rounded-sm", color)}
            style={{ left: `${left}%`, top: -10 }}
            initial={{ y: 0, opacity: 0, rotate: 0 }}
            animate={{
              y: ["0%", "120vh"],
              opacity: [0, 1, 1, 0],
              rotate: [0, 360, 720],
            }}
            transition={{ duration, delay, ease: "easeIn" }}
          />
        );
      })}
    </div>
  );
}
