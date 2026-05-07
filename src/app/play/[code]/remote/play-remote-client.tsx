"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Loader2,
  Plus,
  Smartphone,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import Image from "next/image";
import { motion } from "framer-motion";
import { AvatarPicker } from "@/components/avatars/AvatarPicker";
import { Button } from "@/components/ui/button";
import {
  joinTvChannel,
  type TvChannelHandle,
} from "@/lib/realtime/tv-channel";
import {
  addRemotePlayer,
  readRemoteSlots,
  removeRemotePlayer,
  type RemoteSlot,
} from "@/lib/realtime/remote-actions";
import type {
  QuestionResultPayload,
  QuestionShowPayload,
} from "@/lib/realtime/room-events";
import { cn } from "@/lib/utils";
import { PlayFaceAFaceView } from "../play-face-a-face-view";
import { AnswerButtons } from "@/components/tv/AnswerButtons";
import { RoomClosedOverlay } from "@/components/tv/RoomClosedOverlay";

interface PlayRemoteClientProps {
  code: string;
  roomId: string;
  initialStatus: "waiting" | "playing" | "paused" | "ended";
  /** Si la room a été créée en mode "scan" mais qu'on tombe ici par accident. */
  wrongMode: boolean;
}

type Phase = "waiting" | "playing" | "result" | "ended";

/**
 * P4.1 — Client régie : un seul téléphone joue pour plusieurs joueurs
 * locaux. Lobby = liste des slots ajoutés ; jeu = boutons A/B/C/D qui
 * envoient `answer:submit` avec le token du joueur dont c'est le tour
 * (selon `question:show.currentPlayerToken`).
 */
export function PlayRemoteClient({
  code,
  roomId,
  initialStatus,
  wrongMode,
}: PlayRemoteClientProps) {
  const [slots, setSlots] = useState<RemoteSlot[]>([]);
  const [phase, setPhase] = useState<Phase>(
    initialStatus === "playing" ? "playing" : "waiting",
  );
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null);
  const [result, setResult] = useState<QuestionResultPayload | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<TvChannelHandle | null>(null);
  // P5.1 — En mode régie, on bascule en face-à-face dès qu'on reçoit
  // fa:vote-start. On utilise le 1er slot comme "voix" du téléphone régie
  // pour les actions présentateur (typique : c'est l'un des 2 finalistes
  // qui est le présentateur, et il commande depuis le téléphone régie).
  const [faMode, setFaMode] = useState(false);
  // Q3.1 — Overlay quand l'hôte ferme la partie depuis la TV.
  const [roomClosed, setRoomClosed] = useState(false);

  // Charge les slots existants au mount (depuis localStorage)
  useEffect(() => {
    setSlots(readRemoteSlots(code));
  }, [code]);

  // Channel realtime : track presence pour CHAQUE slot (la TV doit voir
  // tous les joueurs comme "online"). On track une fois pour chaque slot.
  useEffect(() => {
    if (slots.length === 0) {
      // Si on a 0 slot, on track quand même un slot "régie vide" pour ne pas
      // bloquer le démarrage côté TV (mais pas vraiment utile : la TV se
      // base sur la liste des players BDD pour proposer le démarrage, et
      // chaque add() insère un row).
      return;
    }
    const ch = joinTvChannel(code);
    channelRef.current = ch;
    for (const s of slots) {
      void ch.trackPresence({
        token: s.token,
        pseudo: s.pseudo,
        avatarUrl: s.avatarUrl,
        joinedAt: Date.now(),
        role: "player",
      });
    }
    ch.on("question:show", (payload) => {
      setQuestion(payload);
      setResult(null);
      setPhase("playing");
    });
    ch.on("question:result", (payload) => {
      setResult(payload);
      setPhase("result");
      // Met à jour le score du joueur qui vient de répondre
      if (payload.isCorrect) {
        setScores((prev) => ({
          ...prev,
          [payload.byToken]: (prev[payload.byToken] ?? 0) + 1,
        }));
      }
    });
    ch.on("phase:change", (payload) => {
      if (payload.phase === "results") setPhase("ended");
    });
    ch.on("fa:vote-start", () => {
      setFaMode(true);
    });
    ch.on("room:closed", () => {
      setRoomClosed(true);
    });
    return () => {
      void ch.unsubscribe();
      channelRef.current = null;
    };
    // Note : on dépend uniquement du nombre de slots pour ne pas reset le
    // channel à chaque update mineur. trackPresence est rejoué via le
    // 2e effet ci-dessous quand un slot change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, slots.length]);

  async function handleAddPlayer(pseudo: string, avatarUrl: string | null) {
    setError(null);
    const res = await addRemotePlayer({
      roomId,
      code,
      pseudo,
      avatarUrl,
    });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSlots((prev) => [...prev, res.slot]);
    setAddOpen(false);
  }

  async function handleRemovePlayer(slot: RemoteSlot) {
    if (
      !window.confirm(`Retirer ${slot.pseudo} de la partie ?`)
    )
      return;
    const res = await removeRemotePlayer({
      code,
      playerId: slot.playerId,
      token: slot.token,
    });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSlots((prev) => prev.filter((s) => s.playerId !== slot.playerId));
  }

  function handleAnswer(idx: number) {
    if (!question || !channelRef.current) return;
    if (phase !== "playing") return;
    // Trouve le slot correspondant au currentPlayerToken
    const slot = slots.find((s) => s.token === question.currentPlayerToken);
    if (!slot) return;
    channelRef.current.send("answer:submit", {
      questionId: question.questionId,
      chosenIdx: idx,
      playerToken: slot.token,
    });
    setPhase("result");
  }

  if (wrongMode) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Smartphone className="h-12 w-12 text-foreground/40" aria-hidden="true" />
        <p className="font-display text-xl font-bold text-foreground">
          Cette partie est en mode scan
        </p>
        <p className="text-sm text-foreground/60">
          Rejoins-la depuis l&apos;écran principal.
        </p>
      </main>
    );
  }

  // P5.1 — En mode régie face-à-face, on prend le 1er slot comme "voix" du
  // téléphone régie. Limitation MVP : impossible de commander pour le
  // présentateur ET le challenger en même temps depuis le même téléphone
  // (de toute façon, l'un des 2 est sur la TV ; en pratique, le régie
  // joue le rôle du présentateur s'il a été élu).
  if (faMode && channelRef.current && slots[0]) {
    return (
      <>
        <PlayFaceAFaceView
          myToken={slots[0].token}
          channel={channelRef.current}
        />
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
          <p className="text-sm text-foreground/50">
            Le classement final est sur la TV.
          </p>
        </main>
        <RoomClosedOverlay visible={roomClosed} />
      </>
    );
  }

  // Lobby (waiting) : liste des slots + bouton Ajouter
  if (phase === "waiting") {
    return (
      <main className="flex min-h-screen flex-col gap-5 bg-background p-5">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/20 text-gold-warm">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
              Partie {code} · Mode télécommande
            </p>
            <h1 className="font-display text-xl font-extrabold text-foreground">
              Tes joueurs
            </h1>
          </div>
        </header>

        {slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border py-10 text-center text-foreground/50">
            <p className="text-sm">Aucun joueur pour l&apos;instant</p>
            <p className="text-xs">Ajoute au moins 2 joueurs pour démarrer</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {slots.map((s, i) => (
              <li
                key={s.playerId}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/15">
                  {s.avatarUrl ? (
                    <Image
                      src={s.avatarUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="font-display text-sm font-extrabold text-gold-warm">
                      {i + 1}
                    </span>
                  )}
                </div>
                <span className="flex-1 font-display text-base font-bold text-foreground">
                  {s.pseudo}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemovePlayer(s)}
                  aria-label={`Retirer ${s.pseudo}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-buzz/10 hover:text-buzz"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="gold"
          size="lg"
          onClick={() => setAddOpen(true)}
          disabled={slots.length >= 8}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          Ajouter un joueur
        </Button>

        {slots.length >= 8 && (
          <p className="text-center text-xs text-foreground/50">
            Maximum 8 joueurs.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-buzz/40 bg-buzz/10 px-3 py-2 text-sm text-buzz"
          >
            {error}
          </p>
        )}

        <p className="mt-auto text-center text-xs text-foreground/50">
          Une fois prêt, l&apos;hôte démarre la partie depuis la TV.
        </p>

        <AddPlayerModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onConfirm={handleAddPlayer}
          existingCount={slots.length}
        />
        <RoomClosedOverlay visible={roomClosed} />
      </main>
    );
  }

  // En jeu : sélecteur joueur courant + boutons A/B/C/D
  const currentSlot = question
    ? slots.find((s) => s.token === question.currentPlayerToken) ?? null
    : null;
  const canAnswer = phase === "playing" && currentSlot !== null;

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-background p-4">
      <header className="flex items-center justify-between text-foreground">
        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50">
          Partie {code} · Régie
        </p>
        <p className="text-xs text-foreground/60">
          {Object.values(scores).reduce((a, b) => a + b, 0)} bonnes
        </p>
      </header>

      {phase === "result" && result && (
        <ResultBanner result={result} slots={slots} />
      )}

      {/* Slot actif (joueur dont c'est le tour) */}
      {currentSlot ? (
        <motion.section
          key={currentSlot.token}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 rounded-2xl border-2 border-gold bg-gold/10 p-3 shadow-[0_0_24px_rgba(245,183,0,0.3)]"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/30">
            {currentSlot.avatarUrl ? (
              <Image
                src={currentSlot.avatarUrl}
                alt=""
                width={48}
                height={48}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <span className="font-display text-base font-extrabold text-gold-warm">
                {currentSlot.pseudo.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gold-warm">
              C&apos;est à
            </p>
            <p className="font-display text-xl font-extrabold text-foreground">
              {currentSlot.pseudo}
            </p>
          </div>
        </motion.section>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-sm text-foreground/60">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          En attente du prochain tour…
        </div>
      )}

      {question && (
        <section className="rounded-2xl border border-border bg-card p-3 text-center">
          <p className="font-display text-sm font-bold text-foreground">
            {question.enonce}
          </p>
        </section>
      )}

      {/* Q2.1 — Boutons réponses en layout horizontal, palette navy/or. */}
      {question && (
        <AnswerButtons
          choices={question.choices}
          showText
          enabled={canAnswer}
          onAnswer={handleAnswer}
          selectedIdx={
            result && currentSlot && result.byToken === currentSlot.token
              ? result.chosenIdx
              : null
          }
          correctIdx={
            result && currentSlot && result.byToken === currentSlot.token
              ? result.correctIdx
              : null
          }
        />
      )}
      <RoomClosedOverlay visible={roomClosed} />
    </main>
  );
}

function ResultBanner({
  result,
  slots,
}: {
  result: QuestionResultPayload;
  slots: RemoteSlot[];
}) {
  const correct = result.isCorrect;
  const slot = slots.find((s) => s.token === result.byToken);
  const Icon = correct ? Check : X;
  const tone = correct
    ? "border-life-green/40 bg-life-green/15 text-life-green"
    : "border-buzz/40 bg-buzz/15 text-buzz";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold",
        tone,
      )}
      role="status"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="flex-1">
        {slot?.pseudo ?? "Joueur"} —{" "}
        {correct ? "Bonne réponse !" : "Mauvaise réponse"}
      </span>
    </motion.div>
  );
}

function AddPlayerModal({
  open,
  onClose,
  onConfirm,
  existingCount,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (pseudo: string, avatarUrl: string | null) => Promise<void>;
  existingCount: number;
}) {
  const [pseudo, setPseudo] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPseudo(`Joueur ${existingCount + 1}`);
      setAvatarUrl(null);
    }
  }, [open, existingCount]);

  if (!open) return null;

  async function handleConfirm() {
    if (!pseudo.trim() || submitting) return;
    setSubmitting(true);
    await onConfirm(pseudo.trim(), avatarUrl);
    setSubmitting(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-t-3xl border border-border bg-card p-5 sm:rounded-3xl">
        <header className="flex items-center justify-between">
          <h2 className="font-display text-xl font-extrabold text-foreground">
            Ajouter un joueur
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/10"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Choisir un avatar"
            className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-gold/10 hover:border-gold hover:bg-gold/20"
          >
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt=""
                width={64}
                height={64}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <Camera className="h-6 w-6 text-gold-warm" aria-hidden="true" />
            )}
          </button>
          <input
            type="text"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            placeholder="Pseudo"
            maxLength={20}
            className="h-12 flex-1 rounded-xl border border-border bg-card px-4 text-lg font-semibold text-foreground focus:border-gold focus:outline-none"
          />
        </div>

        <Button
          variant="gold"
          size="lg"
          disabled={!pseudo.trim() || submitting}
          onClick={handleConfirm}
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-5 w-5" aria-hidden="true" />
          )}
          Ajouter
        </Button>

        <AvatarPicker
          open={pickerOpen}
          currentUrl={avatarUrl}
          onClose={() => setPickerOpen(false)}
          onPick={(url) => setAvatarUrl(url)}
          uploadBucket="saved-players-avatars"
          uploadPath="guest"
          hideCustomTab
        />
      </div>
    </div>
  );
}
