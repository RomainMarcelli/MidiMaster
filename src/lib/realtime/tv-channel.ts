"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { RoomEventName, RoomEvents } from "./room-events";

/**
 * Wrapper typé autour de `supabase.channel('room:{code}')` pour les events
 * du Mode TV Soirée. Encapsule subscribe / send / cleanup + Presence (P1.1).
 *
 * Channel naming : `room:{code}` (4 chiffres).
 *
 * **Channel sharing + zombie cleanup** : Supabase JS (v2.104+) déduplique
 * les channels par topic dans `RealtimeClient.channel()` — si on appelle
 * `supabase.channel('room:1234')` deux fois, on récupère la MÊME instance
 * la 2e fois. Combiné avec React StrictMode / HMR (qui re-run les useEffect),
 * on se retrouve avec :
 *   1. mount → channel créé + subscribe (state="joined")
 *   2. cleanup → refCount-- mais cleanup async, channel reste dans Supabase
 *   3. re-mount → supabase.channel(topic) retourne l'ancien (state="joined")
 *      → on tente d'y bind des presence callbacks → throw
 *
 * Solution : on attache notre meta (refCount + presenceListeners) au channel
 * via WeakMap. Si on retrouve un channel sans meta dans Supabase, c'est un
 * orphan/zombie → on le force-remove de la liste interne avant de recréer.
 *
 * **Presence (P1.1)** : la source de vérité "qui est en ligne" est Supabase
 * Realtime Presence (heartbeat WebSocket natif, ~15s timeout). L'UI live
 * (lobby, sidebar des joueurs) utilise `presenceState()`.
 *
 * Vague T (#6) — La colonne `tv_room_players.is_connected` n'est plus
 * écrite par notre code (joinRoom/rejoinRoomByToken/addRemotePlayer
 * l'omettent désormais). La colonne reste en BDD avec son DEFAULT TRUE
 * pour ne pas casser la migration mais n'a plus de valeur applicative.
 */

export interface PresencePlayerMeta {
  /** player_token UUID (clé d'identification stable). */
  token: string;
  /** Pseudo (peut changer si édité dans le lobby). */
  pseudo: string;
  /** URL avatar (peut changer si édité dans le lobby). */
  avatarUrl: string | null;
  /** Timestamp ms du track() initial — utile pour ordonnancer les arrivées. */
  joinedAt: number;
  /** Rôle dans la room. "host" = TV, "player" = téléphone. */
  role: "host" | "player";
}

export type PresenceListener = (state: Record<string, PresencePlayerMeta[]>) => void;

export interface TvChannelHandle {
  channel: RealtimeChannel;
  send: <K extends RoomEventName>(event: K, payload: RoomEvents[K]) => void;
  on: <K extends RoomEventName>(
    event: K,
    handler: (payload: RoomEvents[K]) => void,
  ) => void;
  /**
   * Track ce client dans la presence du channel. À appeler une fois après
   * mount (ou sur changement de pseudo/avatar pour broadcast).
   */
  trackPresence: (meta: PresencePlayerMeta) => Promise<void>;
  /** Untrack ce client de la presence (à appeler au unmount/beforeunload). */
  untrackPresence: () => Promise<void>;
  /**
   * S'abonne aux changements de presence. Le handler est appelé avec l'état
   * complet `{ key: PresencePlayerMeta[] }` à chaque sync/join/leave. Retourne
   * une fonction d'unbind.
   */
  onPresence: (listener: PresenceListener) => () => void;
  /** Lit l'état presence courant (snapshot synchrone). */
  presenceState: () => Record<string, PresencePlayerMeta[]>;
  unsubscribe: () => Promise<"ok" | "timed out" | "error">;
}

interface ChannelMeta {
  presenceListeners: Set<PresenceListener>;
  refCount: number;
}

// WeakMap : la meta vit aussi longtemps que le channel. Si Supabase recrée
// le channel, la meta est automatiquement absente (et on en crée une fresh).
const channelMeta = new WeakMap<RealtimeChannel, ChannelMeta>();

function cleanPresenceState(
  channel: RealtimeChannel,
): Record<string, PresencePlayerMeta[]> {
  const raw = channel.presenceState() as Record<
    string,
    Array<PresencePlayerMeta & { presence_ref: string }>
  >;
  const cleaned: Record<string, PresencePlayerMeta[]> = {};
  for (const [key, metas] of Object.entries(raw)) {
    cleaned[key] = metas.map((m) => ({
      token: m.token,
      pseudo: m.pseudo,
      avatarUrl: m.avatarUrl,
      joinedAt: m.joinedAt,
      role: m.role,
    }));
  }
  return cleaned;
}

/**
 * Force-retire un channel orphan de la liste interne de Supabase.
 * Sans ça, le prochain `supabase.channel(topic)` retourne le zombie.
 * On mute directement `getChannels()` qui retourne la référence vivante
 * du tableau (cf. RealtimeClient source) — pas idéal mais pas d'API publique
 * pour ça côté Supabase.
 */
function forceRemoveZombieChannel(
  supabase: ReturnType<typeof createClient>,
  channel: RealtimeChannel,
): void {
  const channels = supabase.getChannels();
  const idx = channels.indexOf(channel);
  if (idx !== -1) channels.splice(idx, 1);
  // Best-effort cleanup côté serveur — fire-and-forget.
  void channel.unsubscribe().catch(() => {
    // ignore — le channel était peut-être déjà mort
  });
}

export function joinTvChannel(roomCode: string): TvChannelHandle {
  const supabase = createClient();
  const realtimeTopic = `realtime:room:${roomCode}`;

  // 1. Cherche un channel existant côté Supabase
  let existing = supabase
    .getChannels()
    .find((c) => c.topic === realtimeTopic);
  let meta = existing ? channelMeta.get(existing) : undefined;

  // 2. Channel orphan (existe mais sans notre meta — typique HMR / StrictMode)
  //    → force-remove pour pouvoir en créer un fresh
  if (existing && !meta) {
    forceRemoveZombieChannel(supabase, existing);
    existing = undefined;
  }

  let channel: RealtimeChannel;
  if (existing && meta) {
    // 3a. Réutilise le channel existant (multi-mount du même code)
    channel = existing;
  } else {
    // 3b. Crée un nouveau channel + bind les presence callbacks AVANT subscribe.
    //
    // Vague U (#1.2) — `broadcast.self = true` est CRITIQUE pour que les
    // bots fonctionnent : la TV simule la réponse d'un bot via
    // `ch.send("ce:answer-submit", ...)`, et son propre handler
    // `ch.on("ce:answer-submit")` doit alors se déclencher. Avec `self:
    // false`, l'event ne revenait pas au sender → la partie restait
    // figée dès qu'un bot devait jouer.
    //
    // Pas de feedback loop : la TV n'écoute QUE les events client→hôte
    // (`*:answer-submit`, `*:duel-*`, `fa:end`) qui ne sont jamais
    // émis par la TV elle-même (sauf justement quand elle simule un bot).
    // Les téléphones reçoivent leurs propres `*:answer-submit` mais ne
    // les écoutent pas (ils écoutent les events host→phones).
    channel = supabase.channel(`room:${roomCode}`, {
      config: {
        broadcast: { self: true, ack: false },
        presence: { key: "" },
      },
    });

    const newMeta: ChannelMeta = {
      presenceListeners: new Set(),
      refCount: 0,
    };
    channelMeta.set(channel, newMeta);
    meta = newMeta;

    function emitPresence() {
      const cleaned = cleanPresenceState(channel);
      for (const l of newMeta.presenceListeners) l(cleaned);
    }

    channel.on("presence", { event: "sync" }, () => emitPresence());
    channel.on("presence", { event: "join" }, () => emitPresence());
    channel.on("presence", { event: "leave" }, () => emitPresence());

    void channel.subscribe();
  }

  meta.refCount++;
  const curChannel = channel;
  const curMeta = meta;

  return {
    channel: curChannel,
    send(event, payload) {
      void curChannel.send({
        type: "broadcast",
        event,
        payload,
      });
    },
    on(event, handler) {
      // Broadcast peut être bindé après subscribe — Supabase l'autorise.
      curChannel.on("broadcast", { event }, ({ payload }) => {
        handler(payload as RoomEvents[typeof event]);
      });
    },
    async trackPresence(meta) {
      try {
        await curChannel.track(meta);
      } catch {
        // ignore — peut arriver si le channel n'est pas encore "joined"
      }
    },
    async untrackPresence() {
      try {
        await curChannel.untrack();
      } catch {
        // ignore
      }
    },
    onPresence(listener) {
      curMeta.presenceListeners.add(listener);
      // Push immédiat de l'état courant si déjà disponible (utile quand
      // un 2e useEffect s'abonne après que la presence sync ait déjà eu lieu).
      try {
        const cleaned = cleanPresenceState(curChannel);
        if (Object.keys(cleaned).length > 0) listener(cleaned);
      } catch {
        // channel pas encore subscribed — la sync arrivera bientôt
      }
      return () => {
        curMeta.presenceListeners.delete(listener);
      };
    },
    presenceState() {
      try {
        return cleanPresenceState(curChannel);
      } catch {
        return {};
      }
    },
    async unsubscribe() {
      curMeta.refCount--;
      if (curMeta.refCount > 0) {
        // Il reste d'autres handles actifs sur ce channel — on garde le
        // channel ouvert pour eux.
        return "ok";
      }
      // Dernier handle : on coupe vraiment.
      try {
        await curChannel.untrack();
      } catch {
        // ignore
      }
      const status = await curChannel.unsubscribe();
      void supabase.removeChannel(curChannel);
      return status;
    },
  };
}
