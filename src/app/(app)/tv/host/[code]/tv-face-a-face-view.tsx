"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Loader2, Mic, Swords, Timer, Trophy, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  joinTvChannel,
  type TvChannelHandle,
} from "@/lib/realtime/tv-channel";
import {
  saveFaceAFaceState,
} from "@/lib/realtime/face-a-face-actions";
import {
  tallyVote,
  type FaceAFaceQuestion,
  type FaceAFaceState,
} from "@/lib/realtime/face-a-face-state";
import {
  faAnswerSchema,
  faGoSchema,
  faVoteCastSchema,
  safeParseEvent,
} from "@/lib/realtime/room-events-schemas";

interface TvFaceAFaceViewProps {
  code: string;
  roomId: string;
  initialState: FaceAFaceState;
  /** Vague T (#1) — Version courante du state pour optimistic locking. */
  initialVersion: number;
  players: Array<{
    id: string;
    pseudo: string;
    avatarUrl: string | null;
    token?: string;
  }>;
  onEnd: () => void;
}

/**
 * P5.1 — Vue TV pour le face-à-face. 3 phases :
 * - vote : 2 finalistes affichés en grand, on attend les votes
 * - playing : challenger en grand avec son timer décompté en live ;
 *   l'autre finaliste (présentateur) en petit + question en grand
 *   (libre au présentateur de la lire ou non, mais on l'affiche pour
 *   le public qui regarde).
 * - ended : annonce du gagnant.
 *
 * L'hôte (TV) est l'arbitre : il calcule le tally du vote, il décompte
 * les timers (interval 1s), il broadcast les ticks et les transitions.
 */
export function TvFaceAFaceView({
  code,
  roomId,
  initialState,
  initialVersion,
  players,
  onEnd,
}: TvFaceAFaceViewProps) {
  const [state, setState] = useState<FaceAFaceState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Vague T (#1) — Version pour optimistic locking. On consomme et on
  // bumpe à chaque save (cf. helper `persistFa`).
  const versionRef = useRef(initialVersion);
  const channelRef = useRef<TvChannelHandle | null>(null);

  // Helper local : encapsule l'optimistic save + tracking de version.
  const persistFa = useCallback(
    (next: FaceAFaceState, status?: "playing" | "ended") => {
      const expected = versionRef.current;
      void saveFaceAFaceState({
        roomId,
        state: next,
        status,
        expectedVersion: expected,
      }).then((res) => {
        if (res.ok) versionRef.current = res.newVersion;
        else if (res.reason === "stale") {
          // eslint-disable-next-line no-console
          console.warn(`[saveFaceAFaceState] stale write (expected v=${expected})`);
        }
      });
    },
    [roomId],
  );

  // Connexion + listeners
  useEffect(() => {
    const ch = joinTvChannel(code);
    channelRef.current = ch;

    // Annonce le démarrage du vote
    ch.send("fa:vote-start", {
      finalists: state.finalists,
      finalistPseudos: state.finalistPseudos,
    });

    // Vague T (#4) — Validation Zod à la réception
    ch.on("fa:vote-cast", (raw) => {
      const payload = safeParseEvent("fa:vote-cast", faVoteCastSchema, raw);
      if (!payload) return;
      setState((prev) => {
        if (prev.phase !== "vote") return prev;
        if (!prev.finalists.includes(payload.forToken)) return prev;
        const next: FaceAFaceState = {
          ...prev,
          votes: { ...prev.votes, [payload.voterToken]: payload.forToken },
        };
        return next;
      });
    });

    ch.on("fa:go", (raw) => {
      const payload = safeParseEvent("fa:go", faGoSchema, raw);
      if (!payload) return;
      setState((prev) => {
        if (prev.phase !== "playing") return prev;
        if (payload.presenterToken !== prev.presenterToken) return prev;
        return { ...prev, ticking: true };
      });
    });

    ch.on("fa:answer", (raw) => {
      const payload = safeParseEvent("fa:answer", faAnswerSchema, raw);
      if (!payload) return;
      setState((prev) => {
        if (prev.phase !== "playing") return prev;
        if (payload.presenterToken !== prev.presenterToken) return prev;
        if (payload.challengerToken !== prev.currentChallengerToken) return prev;
        const next = advanceAfterAnswer(prev, payload.isCorrect);
        // Broadcast la question suivante
        const q = next.questions[next.currentQuestionIdx];
        if (q && next.currentChallengerToken) {
          channelRef.current?.send("fa:question", {
            questionId: q.id,
            enonce: q.enonce,
            currentChallengerToken: next.currentChallengerToken,
            timers: next.timers,
          });
        }
        return next;
      });
    });

    return () => {
      void ch.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Tick du timer côté hôte (TV est l'arbitre du temps)
  useEffect(() => {
    if (state.phase !== "playing" || !state.ticking || !state.currentChallengerToken) {
      return;
    }
    const id = window.setInterval(() => {
      setState((prev) => {
        if (
          prev.phase !== "playing" ||
          !prev.ticking ||
          !prev.currentChallengerToken
        ) {
          return prev;
        }
        const tk = prev.currentChallengerToken;
        const remaining = Math.max(0, (prev.timers[tk] ?? 0) - 1);
        const newTimers = { ...prev.timers, [tk]: remaining };
        // Broadcast tick
        channelRef.current?.send("fa:tick", { token: tk, remaining });
        if (remaining <= 0) {
          // Timeout = élimination
          const winner =
            prev.finalists.find((t) => t !== tk) ?? prev.finalists[0];
          const next: FaceAFaceState = {
            ...prev,
            timers: newTimers,
            phase: "ended",
            ticking: false,
            winnerToken: winner,
          };
          channelRef.current?.send("fa:end", {
            winnerToken: winner,
            loserToken: tk,
          });
          persistFa(next, "ended");
          return next;
        }
        return { ...prev, timers: newTimers };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.phase, state.ticking, state.currentChallengerToken, roomId]);

  /**
   * Calcule le résultat du vote et transitionne vers la phase playing.
   * Appelé depuis le bouton "Lancer le duel" (l'hôte est maître du tempo).
   */
  function handleStartDuel() {
    setState((prev) => {
      if (prev.phase !== "vote") return prev;
      const presenter = tallyVote(prev.votes, prev.finalists);
      const challenger =
        prev.finalists.find((t) => t !== presenter) ?? prev.finalists[0];
      const next: FaceAFaceState = {
        ...prev,
        phase: "playing",
        presenterToken: presenter,
        challengerToken: challenger,
        currentChallengerToken: challenger,
        ticking: false,
        currentQuestionIdx: 0,
      };
      channelRef.current?.send("fa:vote-result", {
        presenterToken: presenter,
        challengerToken: challenger,
      });
      // Broadcast la 1re question (sans timer qui tourne — le présentateur
      // doit cliquer "GO" pour démarrer)
      const q = prev.questions[0];
      if (q) {
        channelRef.current?.send("fa:question", {
          questionId: q.id,
          enonce: q.enonce,
          currentChallengerToken: challenger,
          timers: prev.timers,
        });
      }
      persistFa(next, "playing");
      return next;
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center justify-between text-foreground">
        <div className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-gold-warm" aria-hidden="true" />
          <p className="text-sm font-bold uppercase tracking-widest text-gold-warm">
            Face-à-face · Partie {code}
          </p>
        </div>
        <button
          type="button"
          onClick={onEnd}
          className="inline-flex items-center gap-1.5 rounded-md border border-buzz/30 bg-card px-3 py-1.5 text-xs font-semibold text-buzz hover:bg-buzz/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Terminer
        </button>
      </header>

      {state.phase === "vote" && (
        <VotePanel
          state={state}
          players={players}
          onStartDuel={handleStartDuel}
        />
      )}

      {state.phase === "playing" && (
        <PlayingPanel state={state} players={players} />
      )}

      {state.phase === "ended" && (
        <EndedPanel state={state} players={players} onEnd={onEnd} />
      )}
    </main>
  );
}

// ============================================================================
// Phase: vote
// ============================================================================
function VotePanel({
  state,
  players,
  onStartDuel,
}: {
  state: FaceAFaceState;
  players: Array<{ id: string; pseudo: string; avatarUrl: string | null; token?: string }>;
  onStartDuel: () => void;
}) {
  const totalVotes = Object.keys(state.votes).length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of state.finalists) c[f] = 0;
    for (const v of Object.values(state.votes)) {
      if (v in c) c[v]! += 1;
    }
    return c;
  }, [state.votes, state.finalists]);

  const finalistInfos = state.finalists.map((tk) => {
    const p = players.find((pp) => pp.token === tk);
    return {
      token: tk,
      pseudo: state.finalistPseudos[tk] ?? p?.pseudo ?? "?",
      avatarUrl: p?.avatarUrl ?? null,
      votes: counts[tk] ?? 0,
    };
  });

  return (
    <section className="flex flex-col items-center gap-8 rounded-3xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-10 text-center glow-sun">
      <div>
        <Mic className="mx-auto mb-2 h-10 w-10 text-gold-warm" aria-hidden="true" />
        <h2 className="font-display text-3xl font-extrabold text-foreground lg:text-4xl">
          Qui sera le présentateur ?
        </h2>
        <p className="mt-2 text-sm text-foreground/70">
          Chaque joueur vote pour le finaliste qu&apos;il veut comme présentateur.
        </p>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-2 gap-6">
        {finalistInfos.map((f) => (
          <div
            key={f.token}
            className="flex flex-col items-center gap-3 rounded-3xl border-2 border-gold/30 bg-card p-6"
          >
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border-4 border-gold bg-gold/15 sm:h-32 sm:w-32">
              {f.avatarUrl ? (
                <Image
                  src={f.avatarUrl}
                  alt=""
                  width={128}
                  height={128}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <Crown className="h-12 w-12 text-gold-warm" aria-hidden="true" />
              )}
            </div>
            <p className="font-display text-2xl font-extrabold text-foreground">
              {f.pseudo}
            </p>
            <p className="text-sm font-bold text-gold-warm">
              {f.votes} vote{f.votes > 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-foreground/60">
        {totalVotes} vote{totalVotes > 1 ? "s" : ""} reçu{totalVotes > 1 ? "s" : ""}
      </p>

      <Button variant="gold" size="lg" onClick={onStartDuel}>
        <Swords className="h-5 w-5" aria-hidden="true" />
        Lancer le duel
      </Button>
    </section>
  );
}

// ============================================================================
// Phase: playing
// ============================================================================
function PlayingPanel({
  state,
  players,
}: {
  state: FaceAFaceState;
  players: Array<{ id: string; pseudo: string; avatarUrl: string | null; token?: string }>;
}) {
  const challenger = players.find(
    (p) => p.token === state.currentChallengerToken,
  );
  const presenter = players.find((p) => p.token === state.presenterToken);
  const q = state.questions[state.currentQuestionIdx];
  const remaining = state.currentChallengerToken
    ? (state.timers[state.currentChallengerToken] ?? 0)
    : 0;

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Question + état du duel */}
      <div className="flex flex-col items-center gap-6 rounded-3xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-8 text-center glow-sun">
        <AnimatePresence mode="wait">
          <motion.div
            key={`q-${state.currentQuestionIdx}-${state.currentChallengerToken}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="flex w-full flex-col items-center gap-4"
          >
            <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-bold uppercase tracking-widest text-gold-warm">
              {state.ticking ? "Manche en cours" : "Préparation…"}
            </span>
            {q ? (
              <>
                <h2 className="font-display text-3xl font-extrabold text-foreground lg:text-4xl">
                  {q.enonce}
                </h2>
                <p className="text-sm text-foreground/60">
                  {presenter?.pseudo ?? "Le présentateur"} lit la question.
                </p>
              </>
            ) : (
              <Loader2 className="h-10 w-10 animate-spin text-gold-warm" aria-hidden="true" />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sidebar : challenger + timers */}
      <aside className="flex flex-col gap-3">
        <ChallengerCard
          pseudo={challenger?.pseudo ?? "Challenger"}
          avatarUrl={challenger?.avatarUrl ?? null}
          remaining={remaining}
          ticking={state.ticking}
        />
        {state.finalists
          .filter((t) => t !== state.currentChallengerToken)
          .map((t) => {
            const p = players.find((pp) => pp.token === t);
            return (
              <div
                key={t}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/15">
                  {p?.avatarUrl ? (
                    <Image
                      src={p.avatarUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <Crown className="h-4 w-4 text-gold-warm" aria-hidden="true" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-display text-base font-bold text-foreground">
                    {p?.pseudo ?? state.finalistPseudos[t] ?? "?"}
                  </p>
                  <p className="text-xs text-foreground/60">
                    {state.timers[t] ?? 0}s
                  </p>
                </div>
                {t === state.presenterToken && (
                  <span className="rounded-full bg-sky/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky">
                    Présentateur
                  </span>
                )}
              </div>
            );
          })}
      </aside>
    </section>
  );
}

function ChallengerCard({
  pseudo,
  avatarUrl,
  remaining,
  ticking,
}: {
  pseudo: string;
  avatarUrl: string | null;
  remaining: number;
  ticking: boolean;
}) {
  const danger = remaining <= 10;
  return (
    <div
      className={
        danger
          ? "flex flex-col items-center gap-3 rounded-3xl border-2 border-buzz bg-buzz/10 p-4 text-center shadow-[0_0_24px_rgba(206,31,67,0.4)]"
          : "flex flex-col items-center gap-3 rounded-3xl border-2 border-gold bg-gold/10 p-4 text-center shadow-[0_0_24px_rgba(245,183,0,0.4)]"
      }
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
        Challenger
      </span>
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-gold/30">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={80}
            height={80}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <Crown className="h-10 w-10 text-gold-warm" aria-hidden="true" />
        )}
      </div>
      <p className="font-display text-2xl font-extrabold text-foreground">
        {pseudo}
      </p>
      <div className="flex items-center gap-2">
        <Timer
          className={
            danger ? "h-5 w-5 text-buzz" : "h-5 w-5 text-gold-warm"
          }
          aria-hidden="true"
        />
        <p
          className={
            danger
              ? "font-display text-3xl font-black tabular-nums text-buzz"
              : "font-display text-3xl font-black tabular-nums text-foreground"
          }
        >
          {remaining}s
        </p>
      </div>
      {!ticking && (
        <p className="text-xs font-semibold text-foreground/60">
          En attente du présentateur…
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Phase: ended
// ============================================================================
function EndedPanel({
  state,
  players,
  onEnd,
}: {
  state: FaceAFaceState;
  players: Array<{ id: string; pseudo: string; avatarUrl: string | null; token?: string }>;
  onEnd: () => void;
}) {
  const winner = players.find((p) => p.token === state.winnerToken);
  return (
    <section className="flex flex-col items-center gap-6 rounded-3xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-10 text-center glow-sun">
      <Trophy
        className="h-16 w-16 text-gold-warm"
        aria-hidden="true"
        fill="currentColor"
      />
      <h2 className="font-display text-4xl font-extrabold text-foreground lg:text-5xl">
        {winner?.pseudo ?? "?"} gagne le duel !
      </h2>
      <Button variant="gold" size="lg" onClick={onEnd}>
        Retour à l&apos;accueil
      </Button>
    </section>
  );
}

// ============================================================================
// Helpers
// ============================================================================
/**
 * Logique de transition après une réponse du challenger :
 * - ✅ : timer fige (ticking=false), on inverse les rôles, on passe à la
 *   question suivante. Le nouveau challenger doit cliquer GO côté
 *   présentateur pour relancer.
 * - ❌ : timer continue (ticking reste true), même challenger,
 *   nouvelle question.
 */
function advanceAfterAnswer(
  prev: FaceAFaceState,
  isCorrect: boolean,
): FaceAFaceState {
  const nextQIdx = (prev.currentQuestionIdx + 1) % prev.questions.length;
  if (isCorrect) {
    // Inversion des rôles
    const newChallenger = prev.presenterToken;
    const newPresenter = prev.currentChallengerToken;
    return {
      ...prev,
      currentQuestionIdx: nextQIdx,
      currentChallengerToken: newChallenger,
      presenterToken: newPresenter,
      challengerToken: newChallenger,
      ticking: false,
    };
  }
  // ❌ : même challenger, nouvelle question, timer continue
  return {
    ...prev,
    currentQuestionIdx: nextQIdx,
    ticking: true,
  };
}

export type { FaceAFaceState, FaceAFaceQuestion };
