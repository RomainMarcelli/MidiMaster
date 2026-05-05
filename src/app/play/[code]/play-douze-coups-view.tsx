"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Crown, Loader2, Swords, Users } from "lucide-react";
import Image from "next/image";
import type { TvChannelHandle } from "@/lib/realtime/tv-channel";
import type {
  RoomEvents,
} from "@/lib/realtime/room-events";
import { AnswerButtons } from "@/components/tv/AnswerButtons";
import { AnswerReveal } from "@/components/tv/AnswerReveal";
import { cn } from "@/lib/utils";

/**
 * Vague R — Vue téléphone joueur pour le mode 12 Coups TV (étapes
 * Coup d'Envoi + Coup par Coup + duels). Dispatche selon les events
 * Realtime reçus :
 *  - ce:question-show → vue "joue" (boutons A/B/C/D)
 *  - cpc:question-show → vue "joue" (intrus parmi 7)
 *  - ce:duel-start (challenger=moi)   → vue "choisis ton candidat"
 *  - ce:duel-candidate-selected (=moi) → attendre le tirage des thèmes
 *  - ce:duel-theme-proposals (cand=moi) → vue "choisis ton thème"
 *  - ce:duel-question (cand=moi) → vue "réponds à la question"
 *  - sinon → vue spectateur (regarde les autres jouer)
 *
 * Pas de logique métier ici : tout est piloté par la TV (arbitre).
 */
export function PlayDouzeCoupsView({
  myToken,
  myPseudo,
  channel,
  // Liste de tous les joueurs (utile pour la sélection de candidat).
  players,
}: {
  myToken: string;
  myPseudo: string;
  channel: TvChannelHandle;
  players: Array<{
    token: string;
    pseudo: string;
    avatarUrl: string | null;
    isEliminated: boolean;
  }>;
}) {
  type PhaseKind =
    | "idle"
    | "ce-question"        // moi je joue Coup d'Envoi
    | "ce-spectator"       // qqun d'autre joue Coup d'Envoi
    | "ce-result"          // affichage résultat
    | "cpc-question"       // moi je joue Coup par Coup
    | "cpc-spectator"
    | "cpc-result"
    | "duel-pick-candidate"   // je suis challenger, je choisis
    | "duel-pick-theme"       // je suis candidat, je choisis le thème
    | "duel-question"         // je suis candidat, je réponds
    | "duel-spectator"        // je regarde le duel
    | "duel-result";

  const [phase, setPhase] = useState<PhaseKind>("idle");
  const [question, setQuestion] = useState<RoomEvents["ce:question-show"] | null>(null);
  const [cpcQuestion, setCpcQuestion] = useState<
    RoomEvents["cpc:question-show"] | null
  >(null);
  const [duelThemes, setDuelThemes] = useState<
    RoomEvents["ce:duel-theme-proposals"]["themes"]
  >([]);
  const [duelQuestion, setDuelQuestion] = useState<
    RoomEvents["ce:duel-question"] | null
  >(null);
  const [duelInfo, setDuelInfo] = useState<{
    challengerToken: string;
    challengerPseudo: string;
    candidateToken: string | null;
    candidatePseudo: string | null;
  } | null>(null);
  const [lastResult, setLastResult] = useState<
    | {
        chosenIdx: number;
        correctIdx: number;
        isCorrect: boolean;
        byToken: string;
        /** Vague S7 — explication BDD pour affichage pédagogique. */
        explication?: string | null;
      }
    | null
  >(null);

  useEffect(() => {
    // ---------- Coup d'Envoi ----------
    channel.on("ce:question-show", (payload) => {
      setLastResult(null);
      setQuestion(payload);
      setPhase(
        payload.currentPlayerToken === myToken
          ? "ce-question"
          : "ce-spectator",
      );
    });
    channel.on("ce:question-result", (payload) => {
      setLastResult({
        chosenIdx: payload.chosenIdx,
        correctIdx: payload.correctIdx,
        isCorrect: payload.isCorrect,
        byToken: payload.byToken,
        explication: payload.explication ?? null,
      });
      setPhase("ce-result");
    });

    // ---------- Duel ----------
    channel.on("ce:duel-start", (payload) => {
      setDuelInfo({
        challengerToken: payload.challengerToken,
        challengerPseudo: payload.challengerPseudo,
        candidateToken: null,
        candidatePseudo: null,
      });
      setLastResult(null);
      // Si je suis le challenger → je dois choisir un candidat
      if (payload.challengerToken === myToken) {
        setPhase("duel-pick-candidate");
      } else {
        setPhase("duel-spectator");
      }
    });
    channel.on("ce:duel-candidate-selected", (payload) => {
      setDuelInfo((prev) =>
        prev
          ? {
              ...prev,
              candidateToken: payload.candidateToken,
              candidatePseudo: payload.candidatePseudo,
            }
          : null,
      );
      // Reste spectateur tant que pas tiré les thèmes
      if (payload.candidateToken !== myToken) {
        setPhase("duel-spectator");
      }
    });
    channel.on("ce:duel-theme-proposals", (payload) => {
      setDuelThemes(payload.themes);
      if (payload.candidateToken === myToken) {
        setPhase("duel-pick-theme");
      } else {
        setPhase("duel-spectator");
      }
    });
    channel.on("ce:duel-question", (payload) => {
      setDuelQuestion(payload);
      if (payload.candidateToken === myToken) {
        setPhase("duel-question");
      } else {
        setPhase("duel-spectator");
      }
    });
    channel.on("ce:duel-result", (payload) => {
      setLastResult({
        chosenIdx: payload.chosenIdx,
        correctIdx: payload.correctIdx,
        isCorrect: payload.candidateCorrect,
        byToken: payload.candidateToken,
      });
      setPhase("duel-result");
    });

    // ---------- Coup par Coup ----------
    channel.on("cpc:question-show", (payload) => {
      setLastResult(null);
      setCpcQuestion(payload);
      setPhase(
        payload.currentPlayerToken === myToken
          ? "cpc-question"
          : "cpc-spectator",
      );
    });
    channel.on("cpc:question-result", (payload) => {
      setLastResult({
        chosenIdx: payload.chosenIdx,
        correctIdx: payload.intrusIdx,
        isCorrect: payload.isCorrect,
        byToken: payload.byToken,
        explication: payload.explication ?? null,
      });
      setPhase("cpc-result");
    });
  }, [channel, myToken]);

  // ============================================================
  // Handlers : envoi des actions vers la TV
  // ============================================================
  function handleAnswerCoupEnvoi(idx: number) {
    if (!question) return;
    channel.send("ce:answer-submit", {
      questionId: question.questionId,
      chosenIdx: idx,
      playerToken: myToken,
    });
    setPhase("ce-result"); // optimistic
  }

  function handleAnswerCpc(idx: number) {
    if (!cpcQuestion) return;
    channel.send("cpc:answer-submit", {
      questionId: cpcQuestion.questionId,
      chosenIdx: idx,
      playerToken: myToken,
    });
    setPhase("cpc-result");
  }

  function handlePickCandidate(token: string) {
    const cand = players.find((p) => p.token === token);
    if (!cand) return;
    channel.send("ce:duel-candidate-selected", {
      challengerToken: myToken,
      candidateToken: token,
      candidatePseudo: cand.pseudo,
    });
    setPhase("duel-spectator"); // wait for theme proposals
  }

  function handlePickTheme(themeId: number) {
    const theme = duelThemes.find((t) => t.id === themeId);
    if (!theme) return;
    channel.send("ce:duel-theme-chosen", {
      candidateToken: myToken,
      themeId,
      themeNom: theme.nom,
    });
    setPhase("duel-spectator"); // wait for question
  }

  function handleAnswerDuel(idx: number) {
    if (!duelQuestion) return;
    channel.send("ce:duel-answer-submit", {
      questionId: duelQuestion.questionId,
      chosenIdx: idx,
      candidateToken: myToken,
    });
    setPhase("duel-spectator"); // wait for result
  }

  // ============================================================
  // RENDU selon la phase
  // ============================================================

  if (phase === "ce-question" && question) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header
          pseudo={myPseudo}
          subtitle="Coup d'Envoi · à toi !"
          tone="active"
        />
        <AnswerButtons
          choices={question.choices}
          showText
          enabled
          onAnswer={handleAnswerCoupEnvoi}
        />
      </main>
    );
  }

  if (phase === "ce-result" && question && lastResult) {
    const correctChoice = question.choices.find(
      (c) => c.idx === lastResult.correctIdx,
    );
    const chosenChoice = question.choices.find(
      (c) => c.idx === lastResult.chosenIdx,
    );
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header pseudo={myPseudo} subtitle="Coup d'Envoi" />
        <AnswerButtons
          choices={question.choices}
          showText
          enabled={false}
          onAnswer={() => {}}
          selectedIdx={
            lastResult.byToken === myToken ? lastResult.chosenIdx : null
          }
          correctIdx={lastResult.correctIdx}
        />
        <AnswerReveal
          isCorrect={lastResult.isCorrect}
          isMine={lastResult.byToken === myToken}
          correctText={correctChoice?.text ?? ""}
          chosenText={chosenChoice?.text ?? null}
          explication={lastResult.explication ?? null}
        />
      </main>
    );
  }

  if (phase === "ce-spectator" && question) {
    return <SpectatorView pseudo={question.currentPlayerPseudo} subtitle="joue Coup d'Envoi" />;
  }

  if (phase === "duel-pick-candidate" && duelInfo) {
    const candidates = players.filter(
      (p) => !p.isEliminated && p.token !== myToken,
    );
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-background p-4">
        <Header pseudo={myPseudo} subtitle="Duel · Choisis ton adversaire" tone="duel" />
        <p className="text-sm text-foreground/70">
          Tu es au rouge. Choisis qui va répondre à ta place.
        </p>
        <div className="grid flex-1 grid-cols-2 gap-3">
          {candidates.map((p) => (
            <motion.button
              key={p.token}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => handlePickCandidate(p.token)}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-buzz/40 bg-card p-4 hover:border-buzz hover:bg-buzz/5"
            >
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-foreground/10">
                {p.avatarUrl ? (
                  <Image
                    src={p.avatarUrl}
                    alt=""
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <Crown className="h-10 w-10 text-foreground/40" aria-hidden="true" />
                )}
              </div>
              <p className="font-display text-lg font-extrabold text-foreground">
                {p.pseudo}
              </p>
            </motion.button>
          ))}
        </div>
      </main>
    );
  }

  if (phase === "duel-pick-theme") {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-background p-4">
        <Header pseudo={myPseudo} subtitle="Duel · Choisis ton thème" tone="duel" />
        <p className="text-sm text-foreground/70">
          Le challenger compte sur toi. Choisis le thème de la question.
        </p>
        <div className="grid flex-1 grid-cols-1 gap-3">
          {duelThemes.map((t) => (
            <motion.button
              key={t.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handlePickTheme(t.id)}
              className="flex min-h-[80px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-gold/50 bg-cream p-4 hover:border-gold hover:bg-gold/10"
            >
              <p className="font-display text-2xl font-extrabold text-gold-warm">
                {t.nom}
              </p>
            </motion.button>
          ))}
        </div>
      </main>
    );
  }

  if (phase === "duel-question" && duelQuestion) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header pseudo={myPseudo} subtitle="Duel · à toi !" tone="duel" />
        <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
          {duelQuestion.enonce}
        </p>
        <AnswerButtons
          choices={duelQuestion.choices}
          showText
          enabled
          onAnswer={handleAnswerDuel}
        />
      </main>
    );
  }

  if (phase === "duel-result" && lastResult && duelQuestion) {
    const correctChoice = duelQuestion.choices.find(
      (c) => c.idx === lastResult.correctIdx,
    );
    const chosenChoice = duelQuestion.choices.find(
      (c) => c.idx === lastResult.chosenIdx,
    );
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header pseudo={myPseudo} subtitle="Duel" tone="duel" />
        <AnswerButtons
          choices={duelQuestion.choices}
          showText
          enabled={false}
          onAnswer={() => {}}
          selectedIdx={
            lastResult.byToken === myToken ? lastResult.chosenIdx : null
          }
          correctIdx={lastResult.correctIdx}
        />
        <AnswerReveal
          isCorrect={lastResult.isCorrect}
          isMine={lastResult.byToken === myToken}
          correctText={correctChoice?.text ?? ""}
          chosenText={chosenChoice?.text ?? null}
        />
      </main>
    );
  }

  if (phase === "duel-spectator" && duelInfo) {
    const subtitle = duelInfo.candidatePseudo
      ? `Duel : ${duelInfo.challengerPseudo} vs ${duelInfo.candidatePseudo}`
      : `${duelInfo.challengerPseudo} choisit son adversaire…`;
    return <SpectatorView pseudo="" subtitle={subtitle} icon="duel" />;
  }

  if (phase === "cpc-question" && cpcQuestion) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header
          pseudo={myPseudo}
          subtitle="Coup par Coup · à toi !"
          tone="active"
        />
        <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
          Thème : <span className="text-gold-warm">{cpcQuestion.enonce}</span>
        </p>
        <p className="text-center text-xs text-foreground/60">
          Trouve l&apos;intrus parmi les 7 propositions.
        </p>
        <CpcPropositions
          propositions={cpcQuestion.propositions}
          enabled
          onAnswer={handleAnswerCpc}
        />
      </main>
    );
  }

  if (phase === "cpc-result" && cpcQuestion && lastResult) {
    const correctProp = cpcQuestion.propositions.find(
      (p) => p.idx === lastResult.correctIdx,
    );
    const chosenProp = cpcQuestion.propositions.find(
      (p) => p.idx === lastResult.chosenIdx,
    );
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header pseudo={myPseudo} subtitle="Coup par Coup" />
        <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
          Thème : <span className="text-gold-warm">{cpcQuestion.enonce}</span>
        </p>
        <CpcPropositions
          propositions={cpcQuestion.propositions}
          enabled={false}
          onAnswer={() => {}}
          selectedIdx={
            lastResult.byToken === myToken ? lastResult.chosenIdx : null
          }
          correctIdx={lastResult.correctIdx}
        />
        <AnswerReveal
          isCorrect={lastResult.isCorrect}
          isMine={lastResult.byToken === myToken}
          correctText={correctProp?.text ?? ""}
          chosenText={chosenProp?.text ?? null}
          explication={lastResult.explication ?? null}
          cpcMode
        />
      </main>
    );
  }

  if (phase === "cpc-spectator" && cpcQuestion) {
    return (
      <SpectatorView
        pseudo={cpcQuestion.currentPlayerPseudo}
        subtitle="cherche l'intrus"
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground/60">
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p>En attente de la prochaine question…</p>
    </main>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Header({
  pseudo,
  subtitle,
  tone,
}: {
  pseudo: string;
  subtitle: string;
  tone?: "active" | "duel";
}) {
  return (
    <header className="flex items-center justify-between text-foreground">
      <div>
        <p
          className={cn(
            "text-[10px] font-bold uppercase tracking-widest",
            tone === "duel" ? "text-buzz" : "text-foreground/50",
          )}
        >
          {subtitle}
        </p>
        <p className="font-display text-base font-extrabold">{pseudo}</p>
      </div>
    </header>
  );
}

function SpectatorView({
  pseudo,
  subtitle,
  icon,
}: {
  pseudo: string;
  subtitle: string;
  icon?: "users" | "duel";
}) {
  const Icon = icon === "duel" ? Swords : Users;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <Icon className="h-10 w-10 text-foreground/40" aria-hidden="true" />
      {pseudo && (
        <p className="font-display text-2xl font-extrabold text-foreground">
          {pseudo}
        </p>
      )}
      <p className="text-sm text-foreground/60">{subtitle}</p>
    </main>
  );
}

function CpcPropositions({
  propositions,
  enabled,
  onAnswer,
  selectedIdx,
  correctIdx,
}: {
  propositions: Array<{ idx: number; text: string }>;
  enabled: boolean;
  onAnswer: (idx: number) => void;
  selectedIdx?: number | null;
  correctIdx?: number | null;
}) {
  return (
    <section className="grid flex-1 grid-cols-1 gap-2">
      {propositions.map((p) => {
        const isCorrect = correctIdx != null && p.idx === correctIdx;
        const isSelected = selectedIdx === p.idx;
        const tone = (() => {
          if (correctIdx != null) {
            if (isCorrect) return "border-life-green bg-life-green/15";
            if (isSelected) return "border-buzz bg-buzz/15";
            return "border-border bg-card opacity-60";
          }
          if (isSelected) return "border-gold bg-gold/15";
          return "border-gold/40 bg-cream hover:border-gold";
        })();
        return (
          <motion.button
            key={p.idx}
            type="button"
            whileTap={enabled ? { scale: 0.98 } : undefined}
            onClick={() => enabled && onAnswer(p.idx)}
            disabled={!enabled}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left text-base font-semibold text-foreground transition-all",
              tone,
              !enabled && "cursor-default",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gold/20 font-display font-extrabold text-gold-warm">
              {p.idx + 1}
            </span>
            <span className="flex-1">{p.text}</span>
          </motion.button>
        );
      })}
    </section>
  );
}
