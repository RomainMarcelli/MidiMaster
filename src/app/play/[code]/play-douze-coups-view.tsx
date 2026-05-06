"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Crown, Loader2, Sparkles, Swords, Users } from "lucide-react";
import Image from "next/image";
import type { TvChannelHandle } from "@/lib/realtime/tv-channel";
import type {
  RoomEvents,
} from "@/lib/realtime/room-events";
import { AnswerButtons } from "@/components/tv/AnswerButtons";
import { AnswerReveal } from "@/components/tv/AnswerReveal";
import { PlayerTurnsRedAnimation } from "@/components/tv/PlayerTurnsRedAnimation";
import { PlayerTurnsOrangeAnimation } from "@/components/tv/PlayerTurnsOrangeAnimation";
import { DuelAnnouncementAnimation } from "@/components/tv/DuelAnnouncementAnimation";
import { cn } from "@/lib/utils";

/**
 * Vague R — Vue téléphone joueur pour le mode 12 Coups TV (étapes
 * Coup d'Envoi + Coup par Coup + duels). Dispatche selon les events
 * Realtime reçus :
 *  - ce:question-show → vue "joue" (boutons A/B)
 *  - cpc:question-show → vue "joue" (intrus parmi 7)
 *  - ce:duel-start (challenger=moi)   → vue "choisis ton candidat"
 *  - ce:duel-candidate-selected (=moi) → attendre le tirage des thèmes
 *  - ce:duel-theme-proposals (cand=moi) → vue "choisis ton thème"
 *  - ce:duel-question (cand=moi) → vue "réponds à la question"
 *  - sinon → vue spectateur (regarde les autres jouer)
 *
 * Pas de logique métier ici : tout est piloté par la TV (arbitre).
 *
 * Vague U (#1.1) — `initialEvent` permet d'hydrater le state au mount à
 * partir d'un event reçu AVANT que ce composant existe (race condition
 * fix : le 1er `ce:question-show` arrivait avant le mount, l'event était
 * perdu, l'utilisateur restait figé sur "En attente de la prochaine
 * question…"). Si non-null, on replay l'event au mount pour bypass la
 * race.
 */
export type PlayDouzeCoupsInitialEvent =
  | { kind: "ce-question"; payload: RoomEvents["ce:question-show"] }
  | { kind: "cpc-question"; payload: RoomEvents["cpc:question-show"] }
  | { kind: "duel-start"; payload: RoomEvents["ce:duel-start"] };

export function PlayDouzeCoupsView({
  myToken,
  myPseudo,
  channel,
  // Liste de tous les joueurs (utile pour la sélection de candidat).
  players,
  initialEvent = null,
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
  initialEvent?: PlayDouzeCoupsInitialEvent | null;
}) {
  type PhaseKind =
    | "idle"
    | "ce-question"        // moi je joue Coup d'Envoi
    | "ce-spectator"       // qqun d'autre joue Coup d'Envoi
    | "ce-result"          // affichage résultat
    | "cpc-question"       // moi je joue Coup par Coup (mode continu Vague V)
    | "cpc-spectator"
    | "cpc-result"
    | "cpc-series-complete" // V5 — animation 3s "série complète"
    | "duel-pick-candidate"   // je suis challenger, je choisis
    | "duel-pick-theme"       // je suis candidat, je choisis le thème
    | "duel-question"         // je suis candidat, je réponds
    | "duel-spectator"        // je regarde le duel
    | "duel-result";

  // Vague U (#1.1) — Hydrate le state initial depuis l'event capturé
  // par play-light-client AVANT que ce composant existe. Sans ça, le 1er
  // event est perdu et le téléphone reste figé.
  const initialPhase: PhaseKind = (() => {
    if (!initialEvent) return "idle";
    if (initialEvent.kind === "ce-question") {
      return initialEvent.payload.currentPlayerToken === myToken
        ? "ce-question"
        : "ce-spectator";
    }
    if (initialEvent.kind === "cpc-question") {
      return initialEvent.payload.currentPlayerToken === myToken
        ? "cpc-question"
        : "cpc-spectator";
    }
    // duel-start : si je suis le challenger → je dois choisir un candidat
    return initialEvent.payload.challengerToken === myToken
      ? "duel-pick-candidate"
      : "duel-spectator";
  })();

  const [phase, setPhase] = useState<PhaseKind>(initialPhase);
  const [question, setQuestion] = useState<RoomEvents["ce:question-show"] | null>(
    initialEvent?.kind === "ce-question" ? initialEvent.payload : null,
  );
  const [cpcQuestion, setCpcQuestion] = useState<
    RoomEvents["cpc:question-show"] | null
  >(initialEvent?.kind === "cpc-question" ? initialEvent.payload : null);
  const [duelThemes, setDuelThemes] = useState<
    RoomEvents["ce:duel-theme-proposals"]["themes"]
  >([]);
  // Vague V (#4) — Si non null, ce thème a déjà été utilisé au duel 1
  // et est grisé/désactivé pour le candidat du duel 2.
  const [disabledThemeId, setDisabledThemeId] = useState<number | null>(null);
  const [duelQuestion, setDuelQuestion] = useState<
    RoomEvents["ce:duel-question"] | null
  >(null);
  const [duelInfo, setDuelInfo] = useState<{
    challengerToken: string;
    challengerPseudo: string;
    candidateToken: string | null;
    candidatePseudo: string | null;
  } | null>(
    initialEvent?.kind === "duel-start"
      ? {
          challengerToken: initialEvent.payload.challengerToken,
          challengerPseudo: initialEvent.payload.challengerPseudo,
          candidateToken: null,
          candidatePseudo: null,
        }
      : null,
  );
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
  // Vague V (#5) — Mécanique CPC continue : idx déjà trouvés (verts) sur la
  // question CPC courante. Reset à chaque nouveau cpc:question-show.
  const [cpcFoundIndices, setCpcFoundIndices] = useState<number[]>([]);
  const [cpcSeriesCompleteBy, setCpcSeriesCompleteBy] = useState<string | null>(
    null,
  );
  // Vague V (#3) — Overlays cinématiques pré-duel (3s + 3s).
  const [redAnimOverlay, setRedAnimOverlay] = useState<{
    pseudo: string;
    avatarUrl: string | null;
  } | null>(null);
  const [duelAnnounceOverlay, setDuelAnnounceOverlay] = useState(false);
  // Vague W (#9) — Overlay "passage au orange" 3s sur tous les téléphones.
  const [orangeAnimOverlay, setOrangeAnimOverlay] = useState<{
    pseudo: string;
    avatarUrl: string | null;
  } | null>(null);
  // Vague V (#7) — Pause partie (joueur a quitté) : pseudo du joueur
  // absent. Set par `game:paused`, clear par `game:resumed`.
  const [pausedByPseudo, setPausedByPseudo] = useState<string | null>(null);

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
    // Vague V (#3) — Animations cinématiques 3s + 3s avant le duel-start.
    channel.on("ce:player-turns-red", (payload) => {
      setRedAnimOverlay({
        pseudo: payload.pseudo,
        avatarUrl: payload.avatarUrl,
      });
      window.setTimeout(() => setRedAnimOverlay(null), 3000);
    });
    channel.on("ce:duel-announce", () => {
      setDuelAnnounceOverlay(true);
      window.setTimeout(() => setDuelAnnounceOverlay(false), 3000);
    });
    // Vague W (#9) — Animation "passage au orange" 3s.
    channel.on("ce:player-turns-orange", (payload) => {
      setOrangeAnimOverlay({
        pseudo: payload.pseudo,
        avatarUrl: payload.avatarUrl,
      });
      window.setTimeout(() => setOrangeAnimOverlay(null), 3000);
    });
    // Vague V (#7) — Pause/reprise globale de la partie suite à un abandon.
    channel.on("game:paused", (payload) => {
      setPausedByPseudo(payload.pseudo);
    });
    channel.on("game:resumed", () => {
      setPausedByPseudo(null);
    });
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
      // Vague V (#4) — Mémoriser le thème désactivé (= choisi au duel 1).
      setDisabledThemeId(payload.disabledThemeId ?? null);
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
      // Vague W (#1) — Mécanique tour-par-tour : on re-broadcast
      // `cpc:question-show` à chaque advance turn (même question), pour
      // signaler le nouveau currentPlayerToken. Il ne faut PAS reset
      // `cpcFoundIndices` dans ce cas (sinon on perd l'historique des
      // verts cumulés). Reset uniquement si la question change réellement.
      setCpcQuestion((prevQ) => {
        if (prevQ?.questionId !== payload.questionId) {
          setCpcFoundIndices([]);
          setCpcSeriesCompleteBy(null);
        }
        return payload;
      });
      setPhase(
        payload.currentPlayerToken === myToken
          ? "cpc-question"
          : "cpc-spectator",
      );
    });
    // Vague V (#5) — Progression CPC : un clic correct, foundIndices grandit.
    // Tous les téléphones (y compris spectateurs) reçoivent l'event pour
    // afficher les verts au fur et à mesure.
    channel.on("cpc:answer-progress", (payload) => {
      setCpcFoundIndices(payload.foundIndices);
    });
    // Vague V (#5) — Animation "série complète" 3s puis attente nouvelle question.
    channel.on("cpc:series-complete", (payload) => {
      setCpcSeriesCompleteBy(payload.pseudo);
      setPhase("cpc-series-complete");
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
    // Vague V (#5) — En CPC continu, on N'optimise PAS la transition vers
    // "cpc-result". Le serveur dicte la phase suivante via :
    //  - cpc:answer-progress (correct → reste en cpc-question, idx ajouté aux verts)
    //  - cpc:series-complete (6 trouvées → animation 3s)
    //  - cpc:question-result (intrus → résultat final + advance turn)
    channel.send("cpc:answer-submit", {
      questionId: cpcQuestion.questionId,
      chosenIdx: idx,
      playerToken: myToken,
    });
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

  // Vague V (#7) — Pause de la partie : early return prioritaire (avant les
  // animations pré-duel) pour figer la vue jusqu'à `game:resumed`.
  if (pausedByPseudo) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <Loader2
          className="h-10 w-10 animate-spin text-gold-warm"
          aria-hidden="true"
        />
        <h2 className="font-display text-2xl font-extrabold text-foreground">
          Partie en pause
        </h2>
        <p className="max-w-xs text-foreground/70">
          <strong>{pausedByPseudo}</strong> a quitté la partie. L&apos;hôte
          décide quoi faire&nbsp;…
        </p>
      </main>
    );
  }

  // Vague W (#9) — Animation orange (1ère erreur). Early return.
  if (orangeAnimOverlay) {
    return (
      <AnimatePresence>
        <PlayerTurnsOrangeAnimation
          key="orange-anim"
          pseudo={orangeAnimOverlay.pseudo}
          avatarUrl={orangeAnimOverlay.avatarUrl}
        />
      </AnimatePresence>
    );
  }

  // Vague V (#3) — Overlays cinématiques pré-duel : prennent l'écran
  // complet (fixed inset-0 z-[200]) pendant 3s + 3s avant le duel-start.
  // Early return AVANT toute autre branche pour cacher le rendu courant.
  if (redAnimOverlay) {
    return (
      <AnimatePresence>
        <PlayerTurnsRedAnimation
          key="red-anim"
          pseudo={redAnimOverlay.pseudo}
          avatarUrl={redAnimOverlay.avatarUrl}
        />
      </AnimatePresence>
    );
  }
  if (duelAnnounceOverlay) {
    return (
      <AnimatePresence>
        <DuelAnnouncementAnimation key="duel-anim" />
      </AnimatePresence>
    );
  }

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
    const isMine = lastResult.byToken === myToken;
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header
          pseudo={isMine ? myPseudo : question.currentPlayerPseudo}
          subtitle="Coup d'Envoi"
        />
        {/* Vague V (#6) — Spectateur : pas de boutons A/B, juste l'énoncé.
            Joueur courant : ses boutons figés avec sa réponse soulignée. */}
        {isMine ? (
          <AnswerButtons
            choices={question.choices}
            showText
            enabled={false}
            onAnswer={() => {}}
            selectedIdx={lastResult.chosenIdx}
            correctIdx={lastResult.correctIdx}
          />
        ) : (
          <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
            {question.enonce}
          </p>
        )}
        <AnswerReveal
          isCorrect={lastResult.isCorrect}
          isMine={isMine}
          byPseudo={isMine ? undefined : question.currentPlayerPseudo}
          correctText={correctChoice?.text ?? ""}
          chosenText={chosenChoice?.text ?? null}
          explication={lastResult.explication ?? null}
        />
      </main>
    );
  }

  if (phase === "ce-spectator" && question) {
    // Vague V (#6) — Spectateur : énoncé lisible + indication "C'est au
    // tour de [Pseudo]". Pas de boutons A/B (différencie clairement avec
    // le joueur courant qui voit ses boutons cliquables).
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header pseudo={question.currentPlayerPseudo} subtitle="joue Coup d'Envoi" />
        <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
          {question.enonce}
        </p>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-foreground/60">
          <Users className="h-10 w-10 text-foreground/40" aria-hidden="true" />
          <p className="text-sm">
            C&apos;est au tour de{" "}
            <strong className="text-foreground">
              {question.currentPlayerPseudo}
            </strong>
          </p>
        </div>
      </main>
    );
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
          {duelThemes.map((t) => {
            // Vague V (#4) — Le thème déjà choisi au duel 1 est grisé.
            const isDisabled = disabledThemeId === t.id;
            return (
              <motion.button
                key={t.id}
                type="button"
                disabled={isDisabled}
                whileTap={isDisabled ? undefined : { scale: 0.97 }}
                onClick={() => !isDisabled && handlePickTheme(t.id)}
                className={cn(
                  "flex min-h-[80px] flex-col items-center justify-center gap-1 rounded-2xl border-2 p-4",
                  isDisabled
                    ? "cursor-not-allowed border-foreground/20 bg-foreground/5 opacity-60 grayscale"
                    : "border-gold/50 bg-cream hover:border-gold hover:bg-gold/10",
                )}
              >
                <p
                  className={cn(
                    "font-display text-2xl font-extrabold",
                    isDisabled ? "text-foreground/50" : "text-gold-warm",
                  )}
                >
                  {t.nom}
                </p>
                {isDisabled && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">
                    Déjà utilisé
                  </p>
                )}
              </motion.button>
            );
          })}
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
    const isMine = lastResult.byToken === myToken;
    const candidatePseudo = duelInfo?.candidatePseudo ?? "le candidat";
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header
          pseudo={isMine ? myPseudo : candidatePseudo}
          subtitle="Duel"
          tone="duel"
        />
        {/* Vague V (#6) — Spectateur : énoncé seul, pas de boutons. */}
        {isMine ? (
          <AnswerButtons
            choices={duelQuestion.choices}
            showText
            enabled={false}
            onAnswer={() => {}}
            selectedIdx={lastResult.chosenIdx}
            correctIdx={lastResult.correctIdx}
          />
        ) : (
          <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
            {duelQuestion.enonce}
          </p>
        )}
        <AnswerReveal
          isCorrect={lastResult.isCorrect}
          isMine={isMine}
          byPseudo={isMine ? undefined : candidatePseudo}
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
    // Vague V (#5) — Mécanique continue : le joueur clique des propositions
    // une à une. Les bonnes deviennent vertes (cpcFoundIndices), il continue
    // jusqu'à tomber sur l'intrus OU trouver toutes les bonnes (6/7).
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
          Évite l&apos;intrus. Continue tant que tu trouves les bonnes.
          <span className="ml-2 font-bold text-life-green">
            {cpcFoundIndices.length}/{cpcQuestion.propositions.length - 1}
          </span>
        </p>
        <CpcPropositions
          propositions={cpcQuestion.propositions}
          enabled
          onAnswer={handleAnswerCpc}
          foundIndices={cpcFoundIndices}
        />
      </main>
    );
  }

  // Vague V (#5) — Phase intermédiaire "série complète" : animation 3s sur
  // tous les téléphones avant la nouvelle question.
  if (phase === "cpc-series-complete") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-life-green/10 p-6 text-center">
        <Sparkles className="h-12 w-12 text-life-green" aria-hidden="true" />
        <h2 className="font-display text-2xl font-extrabold text-life-green">
          Série complète !
        </h2>
        {cpcSeriesCompleteBy && (
          <p className="text-base text-foreground/80">
            <strong>{cpcSeriesCompleteBy}</strong> a trouvé toutes les bonnes
            réponses.
          </p>
        )}
      </main>
    );
  }

  if (phase === "cpc-result" && cpcQuestion && lastResult) {
    // Vague W (#1) — En mode tour-par-tour, cpc-result arrive sur CHAQUE
    // clic (correct ou intrus). Si isCorrect=true (clic correct), on N'AFFICHE
    // PAS l'intrus en rouge (sentinelle correctIdx === -1) — anti-cheat.
    const isMine = lastResult.byToken === myToken;
    const isWrongIntrus = !lastResult.isCorrect && lastResult.correctIdx >= 0;
    const chosenProp = cpcQuestion.propositions.find(
      (p) => p.idx === lastResult.chosenIdx,
    );
    const intrusProp = isWrongIntrus
      ? cpcQuestion.propositions.find((p) => p.idx === lastResult.correctIdx)
      : null;
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header
          pseudo={isMine ? myPseudo : cpcQuestion.currentPlayerPseudo}
          subtitle="Coup par Coup"
        />
        <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
          Thème : <span className="text-gold-warm">{cpcQuestion.enonce}</span>
        </p>
        <CpcPropositions
          propositions={cpcQuestion.propositions}
          enabled={false}
          onAnswer={() => {}}
          foundIndices={cpcFoundIndices}
          intrusIdx={isWrongIntrus ? lastResult.correctIdx : null}
        />
        <AnswerReveal
          isCorrect={lastResult.isCorrect}
          isMine={isMine}
          byPseudo={isMine ? undefined : cpcQuestion.currentPlayerPseudo}
          correctText={
            // Pour W (#1), si bonne réponse : afficher la prop choisie (verte)
            // dans le AnswerReveal. Si mauvaise : afficher l'intrus.
            lastResult.isCorrect
              ? chosenProp?.text ?? ""
              : intrusProp?.text ?? ""
          }
          chosenText={chosenProp?.text ?? null}
          explication={lastResult.explication ?? null}
          cpcMode
        />
      </main>
    );
  }

  if (phase === "cpc-spectator" && cpcQuestion) {
    // Vague V (#6 partiel) — Spectateurs voient le thème + les verts cumulés
    // (lecture seule) pour suivre la progression du joueur courant.
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
        <Header
          pseudo={cpcQuestion.currentPlayerPseudo}
          subtitle="cherche l'intrus"
        />
        <p className="rounded-xl border border-border bg-card p-3 text-center font-display text-base font-bold text-foreground">
          Thème : <span className="text-gold-warm">{cpcQuestion.enonce}</span>
        </p>
        <p className="text-center text-xs text-foreground/60">
          <strong>{cpcQuestion.currentPlayerPseudo}</strong> joue —{" "}
          <span className="font-bold text-life-green">
            {cpcFoundIndices.length}/{cpcQuestion.propositions.length - 1}
          </span>
        </p>
        <CpcPropositions
          propositions={cpcQuestion.propositions}
          enabled={false}
          onAnswer={() => {}}
          foundIndices={cpcFoundIndices}
        />
      </main>
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
  foundIndices = [],
  intrusIdx = null,
}: {
  propositions: Array<{ idx: number; text: string }>;
  enabled: boolean;
  onAnswer: (idx: number) => void;
  /**
   * Vague V (#5) — Indices trouvés (verts) cumulatifs sur la question
   * courante. Désactive les clics sur ces idx (already-found côté serveur).
   */
  foundIndices?: number[];
  /**
   * Vague V (#5) — Si non null, l'intrus a été révélé (le joueur courant
   * a cliqué dessus) → affiché en rouge. Les autres restent neutres ou
   * verts selon foundIndices.
   */
  intrusIdx?: number | null;
}) {
  return (
    <section className="grid flex-1 grid-cols-1 gap-2">
      {propositions.map((p) => {
        const isFound = foundIndices.includes(p.idx);
        const isIntrus = intrusIdx === p.idx;
        const tone = (() => {
          if (isIntrus) return "border-buzz bg-buzz/15 text-foreground";
          if (isFound) return "border-life-green bg-life-green/15 text-foreground";
          if (intrusIdx != null) return "border-border bg-card opacity-60";
          return "border-gold/40 bg-cream hover:border-gold";
        })();
        const clickable = enabled && !isFound && !isIntrus;
        return (
          <motion.button
            key={p.idx}
            type="button"
            whileTap={clickable ? { scale: 0.98 } : undefined}
            onClick={() => clickable && onAnswer(p.idx)}
            disabled={!clickable}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left text-base font-semibold transition-all",
              tone,
              !clickable && "cursor-default",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gold/20 font-display font-extrabold text-gold-warm">
              {isFound ? (
                <Check className="h-4 w-4 text-life-green" aria-hidden="true" />
              ) : (
                p.idx + 1
              )}
            </span>
            <span className="flex-1">{p.text}</span>
          </motion.button>
        );
      })}
    </section>
  );
}
