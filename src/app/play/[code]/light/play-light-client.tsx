"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Crown, Loader2, Pencil, Trophy, X } from "lucide-react";
import { motion } from "framer-motion";
import {
  joinTvChannel,
  type TvChannelHandle,
} from "@/lib/realtime/tv-channel";
import {
  readStoredToken,
  rejoinRoomByToken,
} from "@/lib/realtime/player-actions";
import type {
  QuestionResultPayload,
  QuestionShowPayload,
} from "@/lib/realtime/room-events";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { PlayProfileEditModal } from "../play-profile-edit-modal";
import { PlayFaceAFaceView } from "../play-face-a-face-view";
import {
  PlayDouzeCoupsView,
  type PlayDouzeCoupsInitialEvent,
} from "../play-douze-coups-view";
import { AnswerButtons } from "@/components/tv/AnswerButtons";
import { RoomClosedOverlay } from "@/components/tv/RoomClosedOverlay";
import { TrainingQuizz } from "../training-quizz";

interface PlayLightClientProps {
  code: string;
  roomId: string;
  /** Si true, affiche aussi l'énoncé + libellés des choix. */
  fullMode: boolean;
}

type Phase = "waiting" | "playing" | "result" | "ended";

/**
 * UI téléphone : pendant son tour, des gros boutons A/B (ou A/B/C/D) en
 * layout horizontal occupent l'écran (Q2.1 — palette navy/or, plus de
 * rouge/bleu agressif). Hors tour : "X est en train de jouer…" + état.
 *
 * Vibration + flash or au passage du tour. Heartbeat de 12 s pour signaler
 * la connexion. Reconnexion auto si on revient sur la page (via token
 * localStorage) — sinon rebascule vers /play/[code] pour rejoindre proprement.
 */
export function PlayLightClient({
  code,
  roomId,
  fullMode,
}: PlayLightClientProps) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [pseudo, setPseudo] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null);
  const [result, setResult] = useState<QuestionResultPayload | null>(null);
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState(false);
  const channelRef = useRef<TvChannelHandle | null>(null);
  // P2.1 — état d'édition du profil + status de la room (pour verrouiller
  // l'édition une fois la partie commencée).
  const [editOpen, setEditOpen] = useState(false);
  const [roomStatus, setRoomStatus] = useState<
    "waiting" | "playing" | "paused" | "ended"
  >("waiting");
  // P5.1 — Bascule en vue face-à-face quand on reçoit fa:vote-start.
  const [faMode, setFaMode] = useState(false);
  // Vague R — Bascule en vue 12 Coups TV (Coup d'Envoi / Coup par Coup /
  // duels) dès qu'on reçoit le premier event dc:* depuis la TV. Liste des
  // joueurs chargée depuis la BDD (utile pour la sélection de candidat duel).
  // Vague U (#1.1) — On capture l'event qui déclenche dcMode pour
  // l'hydrater dans PlayDouzeCoupsView au mount (sinon il est perdu :
  // PlayDouzeCoupsView mount APRÈS le 1er ce:question-show et bind ses
  // listeners trop tard).
  const [dcMode, setDcMode] = useState(false);
  const [dcInitialEvent, setDcInitialEvent] =
    useState<PlayDouzeCoupsInitialEvent | null>(null);
  const [dcPlayers, setDcPlayers] = useState<
    Array<{
      token: string;
      pseudo: string;
      avatarUrl: string | null;
      isEliminated: boolean;
    }>
  >([]);
  // Q3.1 — Overlay full-screen "Partie fermée par l'hôte" quand on reçoit
  // l'event room:closed depuis la TV.
  const [roomClosed, setRoomClosed] = useState(false);

  // Reconnexion auto au mount
  useEffect(() => {
    const stored = readStoredToken(code);
    if (!stored) {
      router.replace(`/play/${code}`);
      return;
    }
    void rejoinRoomByToken({ code, token: stored }).then((res) => {
      if (!res.ok) {
        router.replace(`/play/${code}`);
        return;
      }
      setToken(stored);
      setPlayerId(res.data.playerId);
    });
  }, [code, router]);

  // Récupère mon pseudo + avatar (utile pour fallback affichage et P2 modal).
  useEffect(() => {
    if (!playerId) return;
    const supabase = createClient();
    void supabase
      .from("tv_room_players")
      .select("pseudo, avatar_url")
      .eq("id", playerId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.pseudo) setPseudo(data.pseudo as string);
        setAvatarUrl((data?.avatar_url as string | null) ?? null);
      });
  }, [playerId]);

  // Vague R — Charge la liste de tous les joueurs de la room (pour la
  // sélection de candidat lors d'un duel). On rafraichit aussi sur
  // changements postgres pour refléter joueurs éliminés / pseudos modifiés.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    function load() {
      void supabase
        .from("tv_room_players")
        .select("player_token, pseudo, avatar_url")
        .eq("room_id", roomId)
        .then(({ data }) => {
          if (cancelled || !data) return;
          setDcPlayers(
            (
              data as Array<{
                player_token: string;
                pseudo: string;
                avatar_url: string | null;
              }>
            ).map((r) => ({
              token: r.player_token,
              pseudo: r.pseudo,
              avatarUrl: r.avatar_url,
              isEliminated: false,
            })),
          );
        });
    }
    load();
    const ch = supabase
      .channel(`tv-room-players-light:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tv_room_players",
          filter: `room_id=eq.${roomId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [roomId]);

  // P2.1 — Suit le statut de la room (waiting/playing/...) pour verrouiller
  // l'édition de profil dès le démarrage.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void supabase
      .from("tv_rooms")
      .select("status")
      .eq("id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setRoomStatus(
          data.status as "waiting" | "playing" | "paused" | "ended",
        );
      });
    const ch = supabase
      .channel(`tv-room-status:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tv_rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const r = payload.new as { status: string };
          setRoomStatus(
            r.status as "waiting" | "playing" | "paused" | "ended",
          );
          if (r.status !== "waiting") setEditOpen(false);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [roomId]);

  // Channel realtime + Presence (P1.1)
  useEffect(() => {
    if (!token || !playerId) return;
    const ch = joinTvChannel(code);
    channelRef.current = ch;

    // Track presence — la TV verra le joueur "online" via presenceState().
    // pseudo/avatarUrl sont remplis quand on les a (sinon "" + null en attendant).
    void ch.trackPresence({
      token,
      pseudo: pseudo || "...",
      avatarUrl,
      joinedAt: Date.now(),
      role: "player",
    });

    ch.on("question:show", (payload) => {
      setQuestion(payload);
      setResult(null);
      setPhase("playing");
      // Mon tour ? → vibration + flash or
      if (payload.currentPlayerToken === token) {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.([200, 100, 200]);
        }
        setFlash(true);
        window.setTimeout(() => setFlash(false), 1000);
      }
    });

    ch.on("question:result", (payload) => {
      setResult(payload);
      setPhase("result");
      if (payload.byToken === token && payload.isCorrect) {
        setScore((s) => s + 1);
      }
    });

    ch.on("phase:change", (payload) => {
      if (payload.phase === "results") setPhase("ended");
    });

    // P5.1 — Bascule en vue face-à-face dès qu'on reçoit le start du vote
    ch.on("fa:vote-start", () => {
      setFaMode(true);
    });

    // Vague R — Bascule en vue 12 Coups TV dès qu'on reçoit n'importe
    // quel event de la phase Coup d'Envoi / Coup par Coup / duels.
    // Vague U (#1.1) — On capture aussi l'event lui-même pour le passer
    // en `initialEvent` à PlayDouzeCoupsView (qui mount APRÈS le bascule
    // et perdrait sinon le 1er event). On ne setDcInitialEvent qu'une
    // SEULE fois (le 1er) — les events suivants sont reçus par
    // PlayDouzeCoupsView via ses propres listeners.
    ch.on("ce:question-show", (payload) => {
      setDcMode(true);
      setDcInitialEvent((prev) =>
        prev ?? { kind: "ce-question", payload },
      );
    });
    ch.on("cpc:question-show", (payload) => {
      setDcMode(true);
      setDcInitialEvent((prev) =>
        prev ?? { kind: "cpc-question", payload },
      );
    });
    ch.on("ce:duel-start", (payload) => {
      setDcMode(true);
      setDcInitialEvent((prev) =>
        prev ?? { kind: "duel-start", payload },
      );
    });

    // Q3.1 — L'hôte a fermé la partie : bascule sur l'overlay redirect
    ch.on("room:closed", () => {
      setRoomClosed(true);
    });

    function onBeforeUnload() {
      void ch.untrackPresence();
    }
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void ch.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token, playerId]);

  // Re-track presence quand le pseudo/avatar change (chargé depuis la BDD,
  // ou édité via P2 modal). Évite que la TV affiche "..." en permanence
  // et propage les changements de profil en live.
  useEffect(() => {
    if (!channelRef.current || !token || !pseudo) return;
    void channelRef.current.trackPresence({
      token,
      pseudo,
      avatarUrl,
      joinedAt: Date.now(),
      role: "player",
    });
  }, [pseudo, avatarUrl, token]);

  function handleAnswer(idx: number) {
    if (!question || !channelRef.current || !token) return;
    if (question.currentPlayerToken !== token) return;
    if (phase !== "playing") return;
    channelRef.current.send("answer:submit", {
      questionId: question.questionId,
      chosenIdx: idx,
      playerToken: token,
    });
    // Optimistic : on bascule en attente de result
    setPhase("result");
  }

  if (!token) {
    return (
      <>
        <main className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gold-warm" aria-hidden="true" />
        </main>
        <RoomClosedOverlay visible={roomClosed} />
      </>
    );
  }

  if (phase === "ended") {
    return (
      <>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <Trophy
            className="h-16 w-16 text-gold-warm"
            aria-hidden="true"
            fill="currentColor"
          />
          <h1 className="font-display text-3xl font-extrabold text-foreground">
            Partie terminée !
          </h1>
          <p className="text-foreground/70">
            Tes réponses : <strong className="text-life-green">{score}</strong> bonnes.
          </p>
          <p className="text-sm text-foreground/50">
            Le classement final est sur la TV.
          </p>
        </main>
        <RoomClosedOverlay visible={roomClosed} />
      </>
    );
  }

  // P5.1 — Bascule en mode face-à-face si la TV a déclenché le vote
  if (faMode && channelRef.current) {
    return (
      <>
        <PlayFaceAFaceView myToken={token} channel={channelRef.current} />
        <RoomClosedOverlay visible={roomClosed} />
      </>
    );
  }

  // Vague R — Bascule en vue 12 Coups TV (Coup d'Envoi / Coup par Coup /
  // duels) dès que la TV envoie un event dc:*. La vue dispatche en interne
  // selon la sous-phase (à toi / spectateur / duel-pick-candidate, etc.).
  if (dcMode && channelRef.current) {
    return (
      <>
        <PlayDouzeCoupsView
          myToken={token}
          myPseudo={pseudo || "..."}
          channel={channelRef.current}
          players={dcPlayers}
          initialEvent={dcInitialEvent}
        />
        <RoomClosedOverlay visible={roomClosed} />
      </>
    );
  }

  const isMyTurn =
    phase === "playing" && question?.currentPlayerToken === token;

  return (
    <main
      className={cn(
        "flex min-h-screen flex-col gap-4 p-4 transition-colors",
        flash ? "bg-gold/40" : "bg-background",
      )}
    >
      <header className="flex items-center justify-between text-foreground">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">
            Partie {code}
          </p>
          <p className="font-display text-base font-extrabold">{pseudo}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* P2.1 — Bouton Modifier visible uniquement en lobby (waiting). */}
          {roomStatus === "waiting" && playerId && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label="Modifier mon profil"
              className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-card px-2.5 py-1 text-xs font-semibold text-gold-warm hover:border-gold hover:bg-gold/10"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              Modifier
            </button>
          )}
          <div className="flex items-center gap-1.5 rounded-full bg-gold/20 px-3 py-1 text-sm font-bold text-gold-warm">
            <Trophy className="h-4 w-4" aria-hidden="true" />
            {score}
          </div>
        </div>
      </header>

      {phase === "result" && result && (
        <ResultBanner result={result} myToken={token} />
      )}

      {fullMode && question && (
        <section className="rounded-2xl border border-border bg-card p-4 text-center">
          {question.format && (
            <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold-warm">
              {question.format}
            </span>
          )}
          <p className="mt-2 font-display text-base font-bold text-foreground">
            {question.enonce}
          </p>
        </section>
      )}

      {isMyTurn && question ? (
        <AnswerButtons
          choices={question.choices}
          showText={fullMode}
          enabled={phase === "playing"}
          onAnswer={handleAnswer}
          selectedIdx={result?.byToken === token ? result.chosenIdx : null}
          correctIdx={result?.byToken === token ? result.correctIdx : null}
        />
      ) : (
        <WaitingTurn question={question} myToken={token} />
      )}

      {playerId && token && (
        <PlayProfileEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => {
            setPseudo(next.pseudo);
            setAvatarUrl(next.avatarUrl);
            setEditOpen(false);
          }}
          playerId={playerId}
          token={token}
          initialPseudo={pseudo}
          initialAvatarUrl={avatarUrl}
        />
      )}
      <RoomClosedOverlay visible={roomClosed} />
    </main>
  );
}

function WaitingTurn({
  question,
  myToken,
}: {
  question: QuestionShowPayload | null;
  myToken: string;
}) {
  const isMine = question?.currentPlayerToken === myToken;
  if (!question) {
    // Vague V (#2) — Plus de loader passif. On affiche un quiz d'entrainement
    // infini pendant l'attente. La bascule vers la vraie partie se fait via
    // les listeners `ce:question-show` / `cpc:question-show` / `ce:duel-start`
    // qui flippent `dcMode = true` en amont (return early sur PlayDouzeCoupsView).
    return <TrainingQuizz />;
  }
  if (isMine) return null;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Crown className="h-10 w-10 text-gold-warm" aria-hidden="true" />
      <p className="font-display text-2xl font-extrabold text-foreground">
        {question.currentPlayerPseudo}
      </p>
      <p className="text-foreground/60">est en train de jouer…</p>
    </div>
  );
}

function ResultBanner({
  result,
  myToken,
}: {
  result: QuestionResultPayload;
  myToken: string;
}) {
  const isMine = result.byToken === myToken;
  const correct = result.isCorrect;
  const Icon = correct ? Check : X;
  const tone = correct
    ? "border-life-green/40 bg-life-green/15 text-life-green"
    : "border-buzz/40 bg-buzz/15 text-buzz";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold",
        tone,
      )}
      role="status"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="flex-1">
        {isMine
          ? correct
            ? "Bonne réponse !"
            : "Mauvaise réponse"
          : correct
            ? "Bonne réponse"
            : "Loupé"}
      </span>
    </motion.div>
  );
}
