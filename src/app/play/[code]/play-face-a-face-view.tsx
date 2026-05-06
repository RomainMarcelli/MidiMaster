"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Crown,
  Loader2,
  Mic,
  Play,
  Swords,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import type { TvChannelHandle } from "@/lib/realtime/tv-channel";
import type {
  FaQuestionPayload,
  FaTickPayload,
  FaVoteResultPayload,
  FaVoteStartPayload,
  FaEndPayload,
} from "@/lib/realtime/room-events";
import {
  PresenterRouletteAnimation,
  type RouletteCandidate,
} from "@/components/tv/PresenterRouletteAnimation";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface PlayFaceAFaceViewProps {
  /** Token du joueur courant (téléphone). */
  myToken: string;
  /** Channel déjà subscribé (le caller s'occupe du cleanup). */
  channel: TvChannelHandle;
}

type FaPhase = "vote" | "playing" | "ended" | "idle";

/**
 * P5.1 — UI face-à-face côté joueur (téléphone). 3 rôles possibles :
 * - vote : tous les joueurs voient les 2 finalistes et votent
 * - playing/présentateur : 3 boutons (GO / ✓ / ✗)
 * - playing/challenger : message "à toi de répondre"
 * - playing/spectateur : message "le duel est en cours"
 * - ended : annonce du gagnant
 *
 * Pas de logique métier ici : tout est piloté par les events Realtime
 * envoyés par la TV (qui est l'arbitre).
 */
export function PlayFaceAFaceView({ myToken, channel }: PlayFaceAFaceViewProps) {
  const [phase, setPhase] = useState<FaPhase>("idle");
  const [finalists, setFinalists] = useState<string[]>([]);
  const [finalistPseudos, setFinalistPseudos] = useState<Record<string, string>>(
    {},
  );
  const [presenterToken, setPresenterToken] = useState<string | null>(null);
  const [challengerToken, setChallengerToken] = useState<string | null>(null);
  const [question, setQuestion] = useState<FaQuestionPayload | null>(null);
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [winnerToken, setWinnerToken] = useState<string | null>(null);
  const [voteCast, setVoteCast] = useState<string | null>(null);
  // Vague W (#10) — Animation roulette présentateur 5s.
  const [rouletteAnim, setRouletteAnim] = useState<{
    winnerToken: string;
    candidates: [RouletteCandidate, RouletteCandidate];
  } | null>(null);

  useEffect(() => {
    channel.on("fa:vote-start", (payload: FaVoteStartPayload) => {
      setPhase("vote");
      setFinalists(payload.finalists);
      setFinalistPseudos(payload.finalistPseudos);
      setVoteCast(null);
      setWinnerToken(null);
    });
    channel.on("fa:vote-result", (payload: FaVoteResultPayload) => {
      setPresenterToken(payload.presenterToken);
      setChallengerToken(payload.challengerToken);
      setPhase("playing");
    });
    // Vague W (#10) — Animation roulette présentateur 5s avant playing.
    channel.on("fa:presenter-roulette", (payload) => {
      if (payload.candidates.length < 2) return;
      const c0 = payload.candidates[0]!;
      const c1 = payload.candidates[1]!;
      setRouletteAnim({
        winnerToken: payload.winnerToken,
        candidates: [c0, c1],
      });
      window.setTimeout(() => setRouletteAnim(null), 5000);
    });
    channel.on("fa:question", (payload: FaQuestionPayload) => {
      setQuestion(payload);
      setTimers(payload.timers);
    });
    channel.on("fa:tick", (payload: FaTickPayload) => {
      setTimers((prev) => ({ ...prev, [payload.token]: payload.remaining }));
    });
    channel.on("fa:end", (payload: FaEndPayload) => {
      setWinnerToken(payload.winnerToken);
      setPhase("ended");
    });
  }, [channel]);

  function handleVote(forToken: string) {
    if (voteCast) return;
    setVoteCast(forToken);
    channel.send("fa:vote-cast", { voterToken: myToken, forToken });
  }

  function handleGo() {
    // eslint-disable-next-line no-console
    console.log("[W3:fa:go] click", {
      presenterToken,
      myToken,
      isPresenter: presenterToken === myToken,
    });
    if (presenterToken !== myToken) return;
    channel.send("fa:go", { presenterToken: myToken });
  }

  function handleValidate(isCorrect: boolean) {
    if (presenterToken !== myToken) return;
    if (!challengerToken) return;
    channel.send("fa:answer", {
      presenterToken: myToken,
      challengerToken,
      isCorrect,
    });
  }

  // Vague W (#10) — Animation roulette présentateur (priorité sur tout).
  if (rouletteAnim) {
    return (
      <AnimatePresence>
        <PresenterRouletteAnimation
          key="presenter-roulette"
          candidates={rouletteAnim.candidates}
          winnerToken={rouletteAnim.winnerToken}
        />
      </AnimatePresence>
    );
  }

  if (phase === "idle") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-foreground/60">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <p>En attente du face-à-face…</p>
      </div>
    );
  }

  if (phase === "vote") {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-background p-4">
        <header className="flex items-center gap-2 text-foreground">
          <Mic className="h-5 w-5 text-gold-warm" aria-hidden="true" />
          <p className="font-display text-lg font-extrabold">
            Vote ton présentateur
          </p>
        </header>
        <p className="text-sm text-foreground/70">
          Quel finaliste tu veux comme présentateur ? L&apos;autre devra
          répondre aux questions.
        </p>
        <div className="grid flex-1 grid-cols-1 gap-3">
          {finalists.map((tk) => (
            <button
              key={tk}
              type="button"
              disabled={!!voteCast}
              onClick={() => handleVote(tk)}
              className={cn(
                "flex flex-1 items-center gap-3 rounded-3xl border-2 p-5 text-left transition-all",
                voteCast === tk
                  ? "border-gold bg-gold/15 shadow-[0_0_24px_rgba(245,183,0,0.4)]"
                  : "border-border bg-card hover:border-gold/50",
                voteCast && voteCast !== tk && "opacity-50",
              )}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gold/15">
                <Crown className="h-8 w-8 text-gold-warm" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="font-display text-2xl font-extrabold text-foreground">
                  {finalistPseudos[tk] ?? "?"}
                </p>
                {voteCast === tk && (
                  <p className="text-xs font-bold text-gold-warm">
                    Vote enregistré
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (phase === "ended") {
    const isWinner = winnerToken === myToken;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        {isWinner ? (
          <>
            <Trophy
              className="h-16 w-16 text-gold-warm"
              aria-hidden="true"
              fill="currentColor"
            />
            <h1 className="font-display text-3xl font-extrabold text-foreground">
              Tu gagnes le duel !
            </h1>
          </>
        ) : (
          <>
            <Swords className="h-12 w-12 text-foreground/40" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-foreground">
              Duel terminé
            </h1>
            <p className="text-sm text-foreground/60">
              Le classement final est sur la TV.
            </p>
          </>
        )}
      </main>
    );
  }

  // playing
  const isPresenter = presenterToken === myToken;
  const isChallenger = challengerToken === myToken;
  const challengerTimer = challengerToken ? (timers[challengerToken] ?? 0) : 0;

  if (isPresenter) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-background p-4">
        <header className="flex items-center gap-2 text-foreground">
          <Mic className="h-5 w-5 text-gold-warm" aria-hidden="true" />
          <p className="font-display text-lg font-extrabold">Présentateur</p>
        </header>
        {question ? (
          <section className="flex flex-col gap-2 rounded-2xl border-2 border-gold/40 bg-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">
              Question (lis-la à voix haute)
            </p>
            <p className="font-display text-xl font-extrabold text-foreground">
              {question.enonce}
            </p>
            {(question as unknown as { choices?: { idx: number; text: string }[] }).choices?.map(
              (c, idx) => (
                <p
                  key={idx}
                  className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-semibold text-foreground"
                >
                  <span className="mr-2 font-display font-extrabold text-gold-warm">
                    {String.fromCharCode(65 + c.idx)}
                  </span>
                  {c.text}
                </p>
              ),
            )}
          </section>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            En attente de la première question…
          </div>
        )}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
          <span className="text-sm text-foreground/70">
            Timer challenger
          </span>
          <span
            className={
              challengerTimer <= 10
                ? "font-display text-2xl font-black tabular-nums text-buzz"
                : "font-display text-2xl font-black tabular-nums text-foreground"
            }
          >
            {challengerTimer}s
          </span>
        </div>
        {/* Vague W (#6) — Boutons compacts, palette sage/bordeaux atténuée
            (cohérent DA cream/navy, moins agressif que life-green/buzz vifs). */}
        <div className="flex flex-col gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={handleGo}
            className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl border-2 border-gold bg-gold/15 px-5 py-3 text-lg font-bold text-gold-warm shadow-sm hover:bg-gold/25"
          >
            <Play className="h-5 w-5" aria-hidden="true" fill="currentColor" />
            GO — démarrer le timer
          </motion.button>
          <div className="grid grid-cols-2 gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => handleValidate(true)}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-sage bg-sage/10 px-4 py-2 text-base font-semibold text-sage hover:bg-sage/20"
            >
              <Check className="h-5 w-5" aria-hidden="true" />
              Bonne
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => handleValidate(false)}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-bordeaux bg-bordeaux/10 px-4 py-2 text-base font-semibold text-bordeaux hover:bg-bordeaux/20"
            >
              <X className="h-5 w-5" aria-hidden="true" />
              Mauvaise
            </motion.button>
          </div>
        </div>
      </main>
    );
  }

  if (isChallenger) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <Swords className="h-12 w-12 text-gold-warm" aria-hidden="true" />
        <p className="font-display text-2xl font-extrabold text-foreground">
          À toi de répondre !
        </p>
        <p className="text-sm text-foreground/70">
          Écoute la question lue par le présentateur.
        </p>
        <div className="flex items-center gap-2 rounded-2xl border-2 border-gold bg-gold/10 px-6 py-4">
          <Timer
            className={
              challengerTimer <= 10 ? "h-6 w-6 text-buzz" : "h-6 w-6 text-gold-warm"
            }
            aria-hidden="true"
          />
          <p
            className={
              challengerTimer <= 10
                ? "font-display text-4xl font-black tabular-nums text-buzz"
                : "font-display text-4xl font-black tabular-nums text-foreground"
            }
          >
            {challengerTimer}s
          </p>
        </div>
      </main>
    );
  }

  // Spectateur
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground/70">
      <Swords className="h-10 w-10 text-foreground/40" aria-hidden="true" />
      <p className="font-display text-xl font-bold text-foreground">
        Duel en cours
      </p>
      <p className="text-sm">Le classement final s&apos;affichera sur la TV.</p>
    </main>
  );
}
