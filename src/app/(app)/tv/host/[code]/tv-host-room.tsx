"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Crown, Loader2, MinusCircle, Play, Smartphone, Tv, Users, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import { endTvRoom } from "@/lib/realtime/room-actions";
import { joinTvChannel } from "@/lib/realtime/tv-channel";
import { startDouzeCoupsTv } from "@/lib/realtime/tv-douze-coups-actions";
import { type TvDouzeCoupsState } from "@/lib/realtime/tv-douze-coups-state";
import { WaitingCarousel } from "./waiting-carousel";
import { TvDouzeCoupsHost } from "./tv-douze-coups-host";
import { ShareLinkButtons } from "@/components/tv/ShareLinkButtons";
import { addBotToRoom, removeBotFromRoom } from "@/lib/realtime/bot-actions";

interface PlayerRow {
  id: string;
  pseudo: string;
  avatarUrl: string | null;
  isConnected: boolean;
  joinedAt: string;
  /** P1.1 — token pour cross-ref Presence. */
  token: string;
  /** Vague S3 — true si bot IA (pseudo "Bot N", token "bot:..."). */
  isBot?: boolean;
  /** Vague S3 — taux de réussite cible du bot (0..100). Default 70. */
  botSkill?: number;
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
              is_bot?: boolean;
              bot_skill?: number;
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
                  isBot: r.is_bot ?? r.player_token.startsWith("bot:"),
                  botSkill: r.bot_skill ?? 70,
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
  // Vague S3 — Les bots sont toujours "connectés" (ils n'ont pas de
  // device qui peut être hors ligne ; l'orchestrateur TV simule leurs
  // réponses).
  const playersWithPresence = useMemo(
    () =>
      players.map((p) => ({
        ...p,
        isConnected: p.isBot ? true : presenceTokens.has(p.token),
      })),
    [players, presenceTokens],
  );

  // Vague S — Le mode 12 Coups TV exige exactement 4 joueurs (humains +
  // bots cumulés). Voir le check explicite dans handleStartDouzeCoups.
  const canStart = useMemo(
    () => playersWithPresence.filter((p) => p.isConnected).length >= 4,
    [playersWithPresence],
  );

  // Vague R — État du mode "12 Coups" (mode complet à 3 phases). Si non
  // null, on bascule sur TvDouzeCoupsHost qui orchestre tout le flux.
  // Vague T — c'est le seul mode TV qui reste (le legacy quizz_2 et le
  // face-à-face direct ont été supprimés). On suit aussi `dcVersion`
  // (initial = 0 après startDouzeCoupsTv) pour l'optimistic locking.
  const [dcState, setDcState] = useState<TvDouzeCoupsState | null>(null);
  const [dcVersion, setDcVersion] = useState(0);
  const [startingDc, setStartingDc] = useState(false);
  // Vague S3 — état UI : ajout/suppression de bots en cours +
  // niveau de skill du bot à ajouter (40=facile, 70=moyen, 90=difficile).
  const [botBusy, setBotBusy] = useState(false);
  const [botSkillLevel, setBotSkillLevel] = useState<"easy" | "medium" | "hard">(
    "medium",
  );

  /** Vague S3 — Ajoute un bot dans la room (jusqu'à 8 joueurs total). */
  async function handleAddBot() {
    if (botBusy || status !== "waiting") return;
    const skill =
      botSkillLevel === "easy" ? 40 : botSkillLevel === "hard" ? 90 : 70;
    setBotBusy(true);
    const res = await addBotToRoom({ roomId, botSkill: skill });
    setBotBusy(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    // Le INSERT postgres_changes va automatiquement enrichir `players`
    // côté client, pas besoin de mutation manuelle ici.
  }

  /** Vague S3 — Retire un bot de la room. */
  async function handleRemoveBot(botToken: string) {
    if (botBusy || status !== "waiting") return;
    setBotBusy(true);
    const res = await removeBotFromRoom({ roomId, botToken });
    setBotBusy(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    // Le DELETE postgres_changes va automatiquement retirer la ligne
    // côté client.
  }

  /** Vague R — Lance le mode "12 Coups" avec tous les joueurs en ligne. */
  async function handleStartDouzeCoups() {
    if (startingDc) return;
    const online = playersWithPresence.filter((p) => p.isConnected);
    // Vague S — Le mode 12 Coups est conçu pour exactement 4 joueurs (3
    // phases enchaînées avec élimination). Avec moins de 4 (humains +
    // bots cumulés), les transitions de phase produisent des états
    // dégénérés (face-à-face avec 1 seul finaliste, etc.). On impose ≥4
    // au démarrage et on incite à compléter avec des bots si besoin.
    if (online.length < 4) {
      alert(
        "Le mode 12 Coups demande 4 joueurs.\n\n" +
          "Tu as " +
          online.length +
          " joueur(s) connecté(s). Ajoute des bots pour compléter à 4 (bouton « Ajouter un bot » ci-dessus).",
      );
      return;
    }
    setStartingDc(true);
    const turnOrder = online
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((p) => p.token);
    const playersMeta = online.map((p) => ({
      token: p.token,
      pseudo: p.pseudo,
      isBot: p.isBot ?? p.token.startsWith("bot:"),
      // Skill remonté du PlayerRow (extrait du postgres_changes), default
      // 70 si le bot a été ajouté avant la migration 0018.
      botSkill: p.botSkill ?? 70,
      avatarUrl: p.avatarUrl,
    }));
    const res = await startDouzeCoupsTv({
      roomId,
      turnOrder,
      playersMeta,
      presenterDesignationMode: "random",
    });
    setStartingDc(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    setDcState(res.state);
    setDcVersion(res.version);
    setStatus("playing");
  }

  /**
   * H4.3 — Lance l'arrêt de partie après confirmation via modal stylée
   * (au lieu du window.confirm natif "localhost:3000 indique : …").
   *
   * Q3.1 — Broadcast l'event `room:closed` AVANT de unsubscribe et de
   * marquer la room ended. Tous les joueurs (light/remote/face-à-face)
   * reçoivent l'event et basculent sur leur écran "Partie fermée par
   * l'hôte" avec countdown 5s vers /play.
   */
  async function handleEnd() {
    setEnding(true);
    const broadcastCh = joinTvChannel(code);
    broadcastCh.send("room:closed", { reason: "host_left" });
    // Petit délai pour laisser partir le broadcast avant unsubscribe.
    await new Promise((r) => setTimeout(r, 300));
    await broadcastCh.unsubscribe();
    await endTvRoom(roomId);
    setEnding(false);
    setShowEndConfirm(false);
    router.push("/tv/host");
  }

  // Vague R — Mode 12 Coups complet (3 phases enchaînées + duels + podium).
  // Vague T — c'est le seul mode TV. Le legacy quizz_2 et le face-à-face
  // direct ont été retirés (handleStart / handleStartFaceAFace n'étaient
  // déjà plus exposés depuis Vague S2).
  if (dcState) {
    return (
      <TvDouzeCoupsHost
        code={code}
        roomId={roomId}
        initialState={dcState}
        initialVersion={dcVersion}
      />
    );
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-7xl flex-col gap-3 overflow-hidden p-4 lg:p-6">
      {/* Vague U (#2) — Layout compact "tout sur 1 écran sans scroll" :
          header mince, 2 colonnes pleine hauteur (QR à gauche compact,
          joueurs + actions à droite), carrousel en bandeau bas. */}
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/20 text-gold-warm">
            <Tv className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gold-warm">
              Mode TV Soirée
            </p>
            <h1 className="font-display text-xl font-extrabold leading-tight text-foreground">
              Salle d&apos;attente
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowEndConfirm(true)}
          aria-label="Mettre fin à la partie"
          className="inline-flex items-center gap-1.5 rounded-md border border-buzz/30 bg-card px-3 py-1.5 text-xs font-semibold text-buzz hover:border-buzz hover:bg-buzz/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Quitter
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(320px,1.3fr)]">
        {/* Bloc QR + code (compact) */}
        <section className="flex min-h-0 flex-col items-center gap-3 overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-4 text-center glow-sun">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gold-warm">
            Pour rejoindre
          </p>
          {joinUrl ? (
            <div className="rounded-xl bg-card p-3 shadow-[0_8px_32px_rgba(245,183,0,0.35)]">
              <QRCodeSVG
                value={joinUrl}
                size={180}
                level="M"
                includeMargin={false}
              />
            </div>
          ) : (
            <div className="flex h-[180px] w-[180px] items-center justify-center rounded-xl bg-card">
              <Loader2 className="h-8 w-8 animate-spin text-gold-warm" aria-hidden="true" />
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-bold text-foreground/70">
              Ou tape le code
            </p>
            <p className="font-display text-5xl font-black tracking-[0.25em] text-foreground sm:text-6xl">
              {code}
            </p>
          </div>
          {joinUrl && status === "waiting" && (
            <ShareLinkButtons
              url={joinUrl}
              title="Rejoins ma partie Mahylan Quiz !"
              text={`Rejoins-moi avec le code ${code}`}
            />
          )}
          {roomModeKind === "remote" && (
            <span className="rounded-full bg-sky/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-sky">
              <Smartphone className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Mode télécommande
            </span>
          )}
        </section>

        {/* Bloc joueurs connectés + actions (à droite) */}
        <section className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 glow-card">
          <div className="flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-foreground" aria-hidden="true" />
              <h2 className="font-display text-base font-bold text-foreground">
                Joueurs ({playersWithPresence.filter((p) => p.isConnected).length}/8)
              </h2>
            </div>
            {!canStart && status === "waiting" && (
              <span className="text-[10px] font-medium text-foreground/50">
                4 joueurs requis
              </span>
            )}
          </div>

          {/* Grille compacte de joueurs (max 8) */}
          {playersWithPresence.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-6 text-center text-sm text-foreground/50">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <p>En attente des premiers joueurs…</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-2">
              {playersWithPresence.map((p) => (
                <li
                  key={p.id}
                  className={
                    p.isBot
                      ? "flex items-center gap-2 rounded-xl border border-sky/40 bg-sky/5 p-2"
                      : "flex items-center gap-2 rounded-xl border border-border bg-background/40 p-2"
                  }
                >
                  <div
                    className={
                      p.isBot
                        ? "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sky/15"
                        : "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gold/15"
                    }
                  >
                    {p.avatarUrl ? (
                      <Image
                        src={p.avatarUrl}
                        alt=""
                        width={36}
                        height={36}
                        className="h-full w-full object-cover"
                        unoptimized
                      />
                    ) : p.isBot ? (
                      <Bot className="h-4 w-4 text-sky" aria-hidden="true" />
                    ) : (
                      <Crown className="h-4 w-4 text-gold-warm" aria-hidden="true" />
                    )}
                  </div>
                  <span className="flex-1 truncate font-display text-sm font-bold text-foreground">
                    {p.pseudo}
                  </span>
                  {p.isBot ? (
                    <>
                      <span className="rounded-full bg-sky/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky">
                        Bot
                      </span>
                      {status === "waiting" && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBot(p.token)}
                          disabled={botBusy}
                          aria-label={`Retirer ${p.pseudo}`}
                          className="text-foreground/40 transition-colors hover:text-buzz disabled:opacity-50"
                        >
                          <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </>
                  ) : (
                    <span
                      className={
                        p.isConnected
                          ? "rounded-full bg-life-green/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-life-green"
                          : "rounded-full bg-buzz/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-buzz"
                      }
                    >
                      {p.isConnected ? "En ligne" : "Hors ligne"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Bouton "Ajouter un bot" + niveau (compact) */}
          {status === "waiting" && playersWithPresence.length < 8 && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={handleAddBot}
                disabled={botBusy}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border-2 border-dashed border-sky/50 bg-card px-3 py-1.5 text-xs font-bold text-sky transition-all hover:-translate-y-px hover:border-sky hover:bg-sky/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {botBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Ajouter un bot
              </button>
              <select
                value={botSkillLevel}
                onChange={(e) =>
                  setBotSkillLevel(e.target.value as "easy" | "medium" | "hard")
                }
                disabled={botBusy}
                aria-label="Niveau du bot"
                className="rounded-md border-2 border-sky/30 bg-card px-2 py-1.5 text-xs font-semibold text-sky disabled:opacity-50"
              >
                <option value="easy">Facile</option>
                <option value="medium">Moyen</option>
                <option value="hard">Difficile</option>
              </select>
            </div>
          )}

          {/* Bouton Démarrer (toujours visible en bas) */}
          <Button
            variant="gold"
            size="lg"
            disabled={!canStart || startingDc || status !== "waiting"}
            onClick={handleStartDouzeCoups}
            className="shrink-0 text-base"
          >
            {startingDc ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-5 w-5" aria-hidden="true" fill="currentColor" />
            )}
            {status === "playing" ? "Partie en cours…" : "Démarrer la partie"}
          </Button>
        </section>
      </div>

      {/* Carrousel en bandeau bas (très compact) — n'affiche qu'en lobby. */}
      {status === "waiting" && (
        <div className="shrink-0">
          <WaitingCarousel
            seed={code}
            quizPreview={quizPreview}
            intervalMs={7000}
          />
        </div>
      )}
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
