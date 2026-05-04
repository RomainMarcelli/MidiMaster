"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Loader2, Mic, Play, Smartphone, Tv, Users, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import { endTvRoom } from "@/lib/realtime/room-actions";
import { prepareTvGame, saveTvGameState } from "@/lib/realtime/tv-game-actions";
import { joinTvChannel, type TvChannelHandle } from "@/lib/realtime/tv-channel";
import { type TvGameState } from "@/lib/realtime/tv-game-state";
import { prepareFaceAFace } from "@/lib/realtime/face-a-face-actions";
import { type FaceAFaceState } from "@/lib/realtime/face-a-face-state";
import { AnimEffect } from "@/components/animations/AnimEffect";
import { WaitingCarousel } from "./waiting-carousel";
import { TvFaceAFaceView } from "./tv-face-a-face-view";

interface PlayerRow {
  id: string;
  pseudo: string;
  avatarUrl: string | null;
  isConnected: boolean;
  joinedAt: string;
  /** P1.1 — token pour cross-ref Presence. */
  token: string;
}

interface TvHostRoomProps {
  roomId: string;
  code: string;
  initialPlayers: PlayerRow[];
  initialStatus: "waiting" | "playing" | "paused" | "ended";
  /** P3.1 — Quiz preview pour le carrousel d'attente (lobby). */
  quizPreview?: { enonce: string; format: string | null } | null;
  /** P4.1 — Mode de la room ("scan" ou "remote"). */
  roomModeKind?: "scan" | "remote";
}

/**
 * Vue TV "Salle d'attente" : QR code + code à 4 chiffres en grand,
 * liste des joueurs qui rejoignent en live (via Supabase Realtime sur
 * la table `tv_room_players`), bouton "Démarrer la partie" qui devient
 * actif dès qu'on a au moins 2 joueurs.
 *
 * Note : pour l'instant, "démarrer" ne fait que basculer le status en
 * `playing`. La suite (vue TV en jeu, sync questions) est dans 5.c+.
 */
export function TvHostRoom({
  roomId,
  code,
  initialPlayers,
  initialStatus,
  quizPreview = null,
  roomModeKind = "scan",
}: TvHostRoomProps) {
  const router = useRouter();
  const [players, setPlayers] = useState(initialPlayers);
  const [status, setStatus] = useState(initialStatus);
  const [starting, setStarting] = useState(false);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  // H4.3 — État du modal "Mettre fin à la partie".
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);

  // Calculé côté client uniquement (origin n'est pas dispo en SSR).
  useEffect(() => {
    if (typeof window !== "undefined") {
      setJoinUrl(`${window.location.origin}/play/${code}`);
    }
  }, [code]);

  // P1.1 — Souscription Realtime à la table tv_room_players (filtre par
  // room_id) UNIQUEMENT pour les changements de profil persistants
  // (INSERT/UPDATE/DELETE). L'état "online/offline" vient de Presence
  // (voir effet ci-dessous) — on ignore donc le champ `is_connected` ici.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tv-room-players:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tv_room_players",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const r = payload.new as {
              id: string;
              pseudo: string;
              avatar_url: string | null;
              joined_at: string;
              player_token: string;
            };
            setPlayers((prev) => {
              if (prev.some((p) => p.id === r.id)) return prev;
              return [
                ...prev,
                {
                  id: r.id,
                  pseudo: r.pseudo,
                  avatarUrl: r.avatar_url,
                  isConnected: false, // mis à jour via Presence
                  joinedAt: r.joined_at,
                  token: r.player_token,
                },
              ];
            });
          } else if (payload.eventType === "UPDATE") {
            const r = payload.new as {
              id: string;
              pseudo: string;
              avatar_url: string | null;
              joined_at: string;
              player_token: string;
            };
            setPlayers((prev) =>
              prev.map((p) =>
                p.id === r.id
                  ? {
                      ...p,
                      pseudo: r.pseudo,
                      avatarUrl: r.avatar_url,
                    }
                  : p,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            const r = payload.old as { id: string };
            setPlayers((prev) => prev.filter((p) => p.id !== r.id));
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  // P1.1 — Source de vérité "online/offline" : Presence du channel
  // `room:{code}`. La TV elle-même track sa propre présence (role: "host")
  // pour signaler qu'elle est live (utile pour les téléphones qui veulent
  // afficher un indicateur "TV connectée").
  const [presenceTokens, setPresenceTokens] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ch = joinTvChannel(code);
    void ch.trackPresence({
      token: `host:${roomId}`,
      pseudo: "TV",
      avatarUrl: null,
      joinedAt: Date.now(),
      role: "host",
    });
    const unbind = ch.onPresence((state) => {
      const tokens = new Set<string>();
      for (const metas of Object.values(state)) {
        for (const m of metas) {
          if (m.role === "player") tokens.add(m.token);
        }
      }
      setPresenceTokens(tokens);
    });
    return () => {
      unbind();
      void ch.unsubscribe();
    };
  }, [code, roomId]);

  // Merge BDD + Presence pour l'UI : isConnected vient de Presence.
  const playersWithPresence = useMemo(
    () =>
      players.map((p) => ({
        ...p,
        isConnected: presenceTokens.has(p.token),
      })),
    [players, presenceTokens],
  );

  const canStart = useMemo(
    () => playersWithPresence.filter((p) => p.isConnected).length >= 2,
    [playersWithPresence],
  );

  // État du jeu TV (en mode playing). Chargé via prepareTvGame ou via
  // un SELECT sur tv_rooms.state si on revient sur la page après refresh.
  const [game, setGame] = useState<TvGameState | null>(null);
  const [hostChannel, setHostChannel] = useState<TvChannelHandle | null>(null);
  // P5.1 — État du face-à-face (null tant que non démarré). Si non null,
  // on affiche TvFaceAFaceView au lieu du flux normal.
  const [faState, setFaState] = useState<FaceAFaceState | null>(null);
  const [startingFa, setStartingFa] = useState(false);

  /** P5.1 — Lance le face-à-face avec les 2 premiers joueurs en ligne. */
  async function handleStartFaceAFace() {
    if (startingFa) return;
    const online = playersWithPresence.filter((p) => p.isConnected);
    if (online.length < 2) {
      alert("Il faut au moins 2 joueurs connectés pour le face-à-face.");
      return;
    }
    setStartingFa(true);
    const [a, b] = online.slice(0, 2);
    if (!a || !b) {
      setStartingFa(false);
      return;
    }
    const finalists: [string, string] = [a.token, b.token];
    const finalistPseudos: Record<string, string> = {
      [a.token]: a.pseudo,
      [b.token]: b.pseudo,
    };
    const res = await prepareFaceAFace({
      roomId,
      finalists,
      finalistPseudos,
      timerSeconds: 60,
    });
    setStartingFa(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    setFaState(res.state);
    setStatus("playing");
  }

  async function handleStart() {
    if (!canStart || starting) return;
    setStarting(true);
    // P1.1 — turnOrder construit depuis Presence (qui est en ligne MAINTENANT)
    // intersecté avec la liste BDD pour l'ordre stable (par joinedAt).
    const turnOrder = playersWithPresence
      .filter((p) => p.isConnected)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((p) => p.token);
    const res = await prepareTvGame({ roomId, turnOrder, totalRounds: 10 });
    if (!res.ok) {
      alert(res.message);
      setStarting(false);
      return;
    }
    setGame(res.state);
    setStatus("playing");
    setStarting(false);
  }

  /**
   * H4.3 — Lance l'arrêt de partie après confirmation via modal stylée
   * (au lieu du window.confirm natif "localhost:3000 indique : …").
   *
   * Q3.1 — Broadcast l'event `room:closed` AVANT de unsubscribe et de
   * marquer la room ended. Tous les joueurs (light/remote/face-à-face)
   * reçoivent l'event et basculent sur leur écran "Partie fermée par
   * l'hôte" avec countdown 5s vers /play.
   *
   * On obtient un handle vers le channel via `joinTvChannel(code)` plutôt
   * que `hostChannel` (qui est null en lobby) — grâce au cache + ref
   * counting du wrapper, on récupère le channel déjà ouvert pour la
   * presence, on incrémente refCount, on broadcast, puis on unsubscribe.
   */
  async function handleEnd() {
    setEnding(true);
    const broadcastCh = joinTvChannel(code);
    broadcastCh.send("room:closed", { reason: "host_left" });
    // Petit délai pour laisser partir le broadcast avant unsubscribe.
    await new Promise((r) => setTimeout(r, 300));
    await broadcastCh.unsubscribe();
    if (hostChannel) await hostChannel.unsubscribe();
    await endTvRoom(roomId);
    setEnding(false);
    setShowEndConfirm(false);
    router.push("/tv/host");
  }

  // Une fois en "playing", on monte le channel hôte qui :
  //  - broadcast la question courante au démarrage et à chaque tour
  //  - écoute les `answer:submit` des téléphones, valide, broadcast résultat
  useEffect(() => {
    if (status !== "playing" || !game) return;

    const ch = joinTvChannel(code);
    setHostChannel(ch);

    // Map token → pseudo pour les payloads broadcast
    const tokenToPseudo = new Map(
      players.map((p) => [
        // Le token n'est pas dans `players` (pas exposé via la query
        // initiale). On va le récupérer en parallèle ci-dessous.
        p.id,
        p.pseudo,
      ]),
    );
    void tokenToPseudo;

    /** Diffuse la question courante à tous (sans la bonne réponse). */
    function broadcastCurrent(state: TvGameState) {
      const q = state.questions[state.currentQuestionIdx];
      if (!q || !state.currentPlayerToken) return;
      ch.send("question:show", {
        questionId: q.id,
        enonce: q.enonce,
        format: q.format ?? null,
        choices: q.choices,
        currentPlayerToken: state.currentPlayerToken,
        currentPlayerPseudo: getPseudoForToken(state.currentPlayerToken) ?? "?",
      });
    }

    function getPseudoForToken(token: string): string | undefined {
      // On ne dispose pas direct des tokens dans `players` (volontairement
      // — la TV peut le voir mais pas l'exposer). Un fetch ad-hoc serait
      // mieux ; pour l'instant on utilise pseudo via cache local rempli
      // par l'effet ci-dessous.
      return tokenPseudoCache.current.get(token);
    }

    // Diffusion initiale
    broadcastCurrent(game);

    ch.on("answer:submit", async (payload) => {
      // Verrou : on n'accepte que la réponse du joueur dont c'est le tour
      // ET de la bonne question (anti-spam, anti-race condition).
      setGame((prev) => {
        if (!prev) return prev;
        if (prev.phase !== "playing") return prev;
        const q = prev.questions[prev.currentQuestionIdx];
        if (!q || q.id !== payload.questionId) return prev;
        if (payload.playerToken !== prev.currentPlayerToken) return prev;

        const isCorrect = payload.chosenIdx === q.correctIdx;
        const newScores = {
          ...prev.scores,
          [payload.playerToken]:
            (prev.scores[payload.playerToken] ?? 0) + (isCorrect ? 1 : 0),
        };

        // Broadcast résultat
        ch.send("question:result", {
          questionId: q.id,
          byToken: payload.playerToken,
          chosenIdx: payload.chosenIdx,
          correctIdx: q.correctIdx,
          isCorrect,
          explication: q.explication ?? null,
        });

        // Avance après 3 s pour laisser lire la bonne réponse
        const nextRound = prev.currentRound + 1;
        const isLast = nextRound >= prev.totalRounds;
        const nextIdx =
          (prev.turnOrder.indexOf(payload.playerToken) + 1) %
          prev.turnOrder.length;
        const nextToken = prev.turnOrder[nextIdx] ?? null;
        const nextQIdx = (prev.currentQuestionIdx + 1) % prev.questions.length;

        const nextState: TvGameState = isLast
          ? {
              ...prev,
              scores: newScores,
              phase: "results",
            }
          : {
              ...prev,
              scores: newScores,
              currentQuestionIdx: nextQIdx,
              currentPlayerToken: nextToken,
              currentRound: nextRound,
            };

        // Persiste l'état (best-effort)
        void saveTvGameState({
          roomId,
          state: nextState,
          status: isLast ? "ended" : undefined,
        });

        // Diffuse la prochaine question après le délai de feedback
        if (!isLast) {
          window.setTimeout(() => broadcastCurrent(nextState), 3500);
        } else {
          ch.send("phase:change", { phase: "results" });
        }

        return nextState;
      });
    });

    return () => {
      void ch.unsubscribe();
      setHostChannel(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, code, roomId]);

  // Cache local token → pseudo (rempli après mount via select sur la BDD)
  const tokenPseudoCache = useTokenPseudoCache(roomId, players);

  // P5.1 — Si on est en face-à-face, on affiche cette vue
  if (faState) {
    return (
      <TvFaceAFaceView
        code={code}
        roomId={roomId}
        initialState={faState}
        players={playersWithPresence}
        onEnd={() => setShowEndConfirm(true)}
      />
    );
  }

  // Switch waiting / playing / results
  if (status === "playing" && game?.phase === "playing") {
    return (
      <TvPlayingView
        code={code}
        game={game}
        players={playersWithPresence}
        tokenCache={tokenPseudoCache.current}
        onEnd={() => setShowEndConfirm(true)}
      />
    );
  }
  if (status === "playing" && game?.phase === "results") {
    return (
      <TvResultsView
        game={game}
        players={playersWithPresence}
        tokenCache={tokenPseudoCache.current}
        onClose={() => setShowEndConfirm(true)}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/20 text-gold-warm">
            <Tv className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
              Mode TV Soirée
            </p>
            <h1 className="font-display text-2xl font-extrabold text-foreground">
              Salle d&apos;attente
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowEndConfirm(true)}
          aria-label="Mettre fin à la partie"
          className="inline-flex items-center gap-1.5 rounded-md border border-buzz/30 bg-card px-3 py-2 text-sm font-semibold text-buzz hover:border-buzz hover:bg-buzz/10"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Quitter
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Bloc QR + code */}
        <section className="flex flex-col items-center gap-5 rounded-3xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-8 text-center glow-sun">
          <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
            Pour rejoindre
          </p>
          {joinUrl ? (
            <div className="rounded-2xl bg-card p-5 shadow-[0_8px_32px_rgba(245,183,0,0.35)]">
              <QRCodeSVG
                value={joinUrl}
                size={280}
                level="M"
                includeMargin={false}
              />
            </div>
          ) : (
            <div className="flex h-[280px] w-[280px] items-center justify-center rounded-2xl bg-card">
              <Loader2 className="h-8 w-8 animate-spin text-gold-warm" aria-hidden="true" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-foreground/70">
              Ou tape le code
            </p>
            <p className="font-display text-7xl font-black tracking-[0.3em] text-foreground sm:text-8xl">
              {code}
            </p>
          </div>
          {roomModeKind === "remote" ? (
            <div className="flex flex-col items-center gap-1.5">
              <span className="rounded-full bg-sky/15 px-3 py-1 text-xs font-bold uppercase tracking-widest text-sky">
                <Smartphone className="mr-1 inline h-3 w-3" aria-hidden="true" />
                Mode télécommande
              </span>
              <p className="max-w-xs text-sm text-foreground/70">
                Un seul téléphone (la régie) suffit. Il scanne ce QR code et
                ajoute tous les joueurs depuis sa liste.
              </p>
            </div>
          ) : (
            <p className="max-w-xs text-sm text-foreground/70">
              Sur ton téléphone, ouvre l&apos;app et entre ce code, ou scanne
              le QR code ci-dessus.
            </p>
          )}
          {/* P3.1 — Carrousel d'ambiance dans le coin bas du bloc QR.
              N'apparaît qu'en lobby (status waiting). */}
          {status === "waiting" && (
            <div className="mt-2 w-full max-w-md">
              <WaitingCarousel
                seed={code}
                quizPreview={quizPreview}
                intervalMs={7000}
              />
            </div>
          )}
        </section>

        {/* Bloc joueurs connectés */}
        <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 glow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-foreground" aria-hidden="true" />
              <h2 className="font-display text-xl font-bold text-foreground">
                Joueurs connectés
              </h2>
            </div>
            <span className="rounded-full bg-gold/15 px-3 py-1 text-sm font-bold text-gold-warm">
              {playersWithPresence.filter((p) => p.isConnected).length} / 8
            </span>
          </div>

          {playersWithPresence.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-10 text-center text-foreground/50">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <p>En attente des premiers joueurs…</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {playersWithPresence.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/15">
                    {p.avatarUrl ? (
                      <Image
                        src={p.avatarUrl}
                        alt=""
                        width={48}
                        height={48}
                        className="h-full w-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <Crown className="h-5 w-5 text-gold-warm" aria-hidden="true" />
                    )}
                  </div>
                  <span className="flex-1 font-display text-lg font-bold text-foreground">
                    {p.pseudo}
                  </span>
                  <span
                    className={
                      p.isConnected
                        ? "rounded-full bg-life-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-life-green"
                        : "rounded-full bg-buzz/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-buzz"
                    }
                  >
                    {p.isConnected ? "En ligne" : "Hors ligne"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Button
            variant="gold"
            size="lg"
            disabled={!canStart || starting || status !== "waiting"}
            onClick={handleStart}
            className="mt-auto text-lg"
          >
            {starting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-5 w-5" aria-hidden="true" fill="currentColor" />
            )}
            {status === "playing" ? "Partie en cours…" : "Démarrer la partie"}
          </Button>
          {/* P5.1 — Bouton "Lancer face-à-face" (alternative au mode regular). */}
          {status === "waiting" && (
            <button
              type="button"
              disabled={!canStart || startingFa}
              onClick={handleStartFaceAFace}
              className="inline-flex items-center justify-center gap-2 rounded-md border-2 border-sky/50 bg-card px-4 py-2 text-sm font-bold text-sky transition-all hover:-translate-y-px hover:border-sky hover:bg-sky/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startingFa ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mic className="h-4 w-4" aria-hidden="true" />
              )}
              Mode face-à-face (présentateur)
            </button>
          )}
          {!canStart && status === "waiting" && (
            <p className="text-center text-xs text-foreground/50">
              Au moins 2 joueurs requis pour démarrer.
            </p>
          )}
        </section>
      </div>
      {/* H4.3 — Modal "Mettre fin à la partie" en remplacement du
          window.confirm natif. */}
      <ConfirmDialog
        open={showEndConfirm}
        onClose={() => !ending && setShowEndConfirm(false)}
        onConfirm={handleEnd}
        isPending={ending}
        title="Mettre fin à la partie ?"
        description="Tous les joueurs vont être déconnectés. Cette action est irréversible."
        confirmLabel={ending ? "Fermeture…" : "Mettre fin"}
        confirmVariant="danger"
      />
    </main>
  );
}

// ============================================================================
// useTokenPseudoCache : map token → pseudo
// ============================================================================
// P1.1 — Maintenant qu'on a `token` directement dans la liste players (issu
// de la query server + Realtime postgres_changes), ce cache est juste un
// dérivé de l'array. On garde la signature ref-style pour ne pas casser
// les callers existants (TvPlayingView, TvResultsView).
function useTokenPseudoCache(
  _roomId: string,
  players: Array<{ token: string; pseudo: string }>,
) {
  const cache = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    cache.current.clear();
    for (const p of players) cache.current.set(p.token, p.pseudo);
  }, [players]);
  return cache;
}

// ============================================================================
// TvPlayingView : grand écran avec question + scores + qui joue
// ============================================================================
function TvPlayingView({
  code,
  game,
  players,
  tokenCache,
  onEnd,
}: {
  code: string;
  game: TvGameState;
  players: Array<{
    id: string;
    pseudo: string;
    avatarUrl: string | null;
    token?: string;
  }>;
  tokenCache: Map<string, string>;
  onEnd: () => void;
}) {
  const q = game.questions[game.currentQuestionIdx];
  const currentPseudo = game.currentPlayerToken
    ? tokenCache.get(game.currentPlayerToken)
    : "?";
  const currentPlayer = useMemo(
    () =>
      players.find(
        (p) =>
          p.token === game.currentPlayerToken ||
          tokenCache.get(game.currentPlayerToken ?? "") === p.pseudo,
      ),
    [players, game.currentPlayerToken, tokenCache],
  );

  // P4.1 — Animation "À toi, [Joueur]" 1.6s à chaque changement de tour.
  const [announcing, setAnnouncing] = useState(false);
  const lastAnnouncedRef = useRef<string | null>(null);
  useEffect(() => {
    const tk = game.currentPlayerToken;
    if (!tk) return;
    if (lastAnnouncedRef.current === tk) return;
    lastAnnouncedRef.current = tk;
    setAnnouncing(true);
    const id = window.setTimeout(() => setAnnouncing(false), 1600);
    return () => window.clearTimeout(id);
  }, [game.currentPlayerToken]);

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6 lg:p-10">
      <AnimatePresence>
        {announcing && currentPseudo && (
          <motion.div
            key={`ann-${game.currentPlayerToken}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-4 text-center">
              {currentPlayer?.avatarUrl ? (
                <Image
                  src={currentPlayer.avatarUrl}
                  alt=""
                  width={160}
                  height={160}
                  className="h-32 w-32 rounded-3xl border-4 border-gold object-cover shadow-[0_0_64px_rgba(245,183,0,0.7)] sm:h-40 sm:w-40"
                  unoptimized
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-3xl border-4 border-gold bg-gold/30 shadow-[0_0_64px_rgba(245,183,0,0.7)] sm:h-40 sm:w-40">
                  <Crown className="h-16 w-16 text-gold-warm" aria-hidden="true" />
                </div>
              )}
              <p className="text-xl font-bold uppercase tracking-widest text-gold">
                À toi
              </p>
              <p className="font-display text-6xl font-extrabold text-background sm:text-7xl">
                {currentPseudo}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <header className="flex items-center justify-between text-foreground">
        <p className="text-sm font-bold uppercase tracking-widest text-gold-warm">
          Partie {code} · Tour {game.currentRound + 1} / {game.totalRounds}
        </p>
        <button
          type="button"
          onClick={onEnd}
          className="inline-flex items-center gap-1.5 rounded-md border border-buzz/30 bg-card px-3 py-1.5 text-xs font-semibold text-buzz hover:bg-buzz/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Terminer
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar joueurs */}
        <aside className="flex flex-col gap-2">
          {players.map((p) => {
            const score =
              Object.entries(game.scores).find(
                ([token]) => tokenCache.get(token) === p.pseudo,
              )?.[1] ?? 0;
            const isActive = currentPseudo === p.pseudo;
            return (
              <div
                key={p.id}
                className={
                  isActive
                    ? "flex items-center gap-3 rounded-2xl border-2 border-gold bg-gold/15 p-3 shadow-[0_0_24px_rgba(245,183,0,0.5)]"
                    : "flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                }
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/15">
                  {p.avatarUrl ? (
                    <Image
                      src={p.avatarUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <Crown className="h-5 w-5 text-gold-warm" aria-hidden="true" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-display text-base font-extrabold text-foreground">
                    {p.pseudo}
                  </p>
                  <p className="text-xs text-foreground/60">
                    {score} bonne{score > 1 ? "s" : ""} réponse{score > 1 ? "s" : ""}
                  </p>
                </div>
                {isActive && (
                  <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-on-color">
                    À jouer
                  </span>
                )}
              </div>
            );
          })}
        </aside>

        {/* Question géante */}
        <section className="flex flex-col items-center justify-center gap-8 rounded-3xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-10 text-center glow-sun">
          {q ? (
            <>
              {q.format && (
                <span className="rounded-full bg-gold/20 px-4 py-1 text-sm font-bold uppercase tracking-widest text-gold-warm">
                  {q.format}
                </span>
              )}
              <h2 className="font-display text-3xl font-extrabold text-foreground lg:text-5xl">
                {q.enonce}
              </h2>
              <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
                {q.choices.map((c) => (
                  <div
                    key={c.idx}
                    className="flex items-center gap-3 rounded-xl border-2 border-gold/30 bg-card px-6 py-5 text-left text-xl font-semibold text-foreground"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/20 font-display font-extrabold text-gold-warm">
                      {String.fromCharCode(65 + c.idx)}
                    </span>
                    <span className="flex-1">{c.text}</span>
                  </div>
                ))}
              </div>
              <p className="text-lg font-bold text-foreground/70">
                À toi de jouer, <span className="text-gold-warm">{currentPseudo}</span> !
              </p>
            </>
          ) : (
            <Loader2 className="h-12 w-12 animate-spin text-gold-warm" aria-hidden="true" />
          )}
        </section>
      </div>
    </main>
  );
}

// ============================================================================
// TvResultsView : podium final
// ============================================================================
function TvResultsView({
  game,
  players,
  tokenCache,
  onClose,
}: {
  game: TvGameState;
  players: Array<{
    id: string;
    pseudo: string;
    avatarUrl: string | null;
  }>;
  tokenCache: Map<string, string>;
  onClose: () => void;
}) {
  const ranked = useMemo(() => {
    const arr = players.map((p) => {
      const token = Array.from(tokenCache.entries()).find(
        ([, pseudo]) => pseudo === p.pseudo,
      )?.[0];
      const score = token ? (game.scores[token] ?? 0) : 0;
      return { ...p, score };
    });
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }, [players, game.scores, tokenCache]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <AnimEffect animation="crown" size="lg" autoCloseMs={0} />
      <AnimEffect animation="coins-rain" size="fullscreen" autoCloseMs={2400} />
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-gold-warm">
          Mode TV — Partie terminée
        </p>
        <h1 className="font-display text-5xl font-extrabold text-foreground">
          {ranked[0]?.pseudo ?? "Pas de vainqueur"} gagne !
        </h1>
      </div>
      <ul className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-card p-5 glow-card">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={
              i === 0
                ? "flex items-center gap-3 text-gold-warm"
                : "flex items-center gap-3 text-foreground"
            }
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/10 font-display text-base font-extrabold text-foreground">
              {i + 1}
            </span>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/15">
              {p.avatarUrl ? (
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
            <span className="flex-1 text-left font-display text-lg font-bold">
              {p.pseudo}
            </span>
            <span className="text-base font-bold tabular-nums">
              {p.score}
            </span>
          </li>
        ))}
      </ul>
      <Button variant="gold" size="lg" onClick={onClose}>
        Retour à l&apos;accueil
      </Button>
    </main>
  );
}
