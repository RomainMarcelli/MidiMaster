"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Actions client (téléphone) pour rejoindre/quitter une room TV.
 * Pas de Server Actions ici : les téléphones ne sont PAS authentifiés,
 * donc tout passe par le client supabase-js avec les RLS publiques de
 * `tv_rooms` / `tv_room_players`.
 *
 * Le `player_token` est généré côté client (UUID v4 via `crypto.randomUUID`)
 * et stocké en localStorage pour la reconnexion.
 *
 * **P1.1** : la présence "online/offline" passe maintenant par Supabase
 * Realtime Presence (cf. tv-channel.ts). Les fonctions `sendHeartbeat` et
 * `markDisconnected` sont conservées en no-op pour rétrocompatibilité mais
 * ne sont plus appelées par les composants /play.
 */

const TOKEN_KEY_PREFIX = "mahylan-tv-token:";

/** Génère un token UUID v4 pour identifier ce téléphone côté serveur. */
export function generatePlayerToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback déterministe-only-en-dernier-recours
  return `tk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function readStoredToken(roomCode: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY_PREFIX + roomCode);
}

export function storeToken(roomCode: string, token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY_PREFIX + roomCode, token);
}

export function clearStoredToken(roomCode: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY_PREFIX + roomCode);
}

export interface JoinedRoom {
  roomId: string;
  playerId: string;
  playerToken: string;
}

export interface JoinError {
  ok: false;
  message: string;
}

/**
 * Vérifie l'existence d'une room par son code (status != ended).
 * Retourne `null` si introuvable.
 */
export async function findActiveRoomByCode(code: string): Promise<{
  id: string;
  status: "waiting" | "playing" | "paused" | "ended";
} | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("tv_rooms")
    .select("id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    status: data.status as "waiting" | "playing" | "paused" | "ended",
  };
}

/**
 * Rejoint une room en tant que joueur (téléphone). Génère et stocke un
 * `player_token` UUID. À la reconnexion, on appelle `rejoinRoomByToken`
 * plutôt que `joinRoom` pour réutiliser la même ligne.
 */
export async function joinRoom(input: {
  code: string;
  pseudo: string;
  avatarUrl?: string | null;
}): Promise<{ ok: true; data: JoinedRoom } | JoinError> {
  const room = await findActiveRoomByCode(input.code);
  if (!room) {
    return { ok: false, message: "Code invalide ou partie terminée." };
  }

  const supabase = createClient();
  const token = generatePlayerToken();
  // Vague T (#6) — On n'écrit plus `is_connected` : la presence WS est
  // désormais l'unique source pour la connectivité (cf. tv-channel.ts).
  // La colonne BDD reste à TRUE par défaut comme cache informatif mais
  // n'est plus consultée par l'UI.
  const { data, error } = await supabase
    .from("tv_room_players")
    .insert({
      room_id: room.id,
      player_token: token,
      pseudo: input.pseudo.trim(),
      avatar_url: input.avatarUrl ?? null,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? "Impossible de rejoindre la partie.",
    };
  }

  storeToken(input.code, token);
  return {
    ok: true,
    data: { roomId: room.id, playerId: data.id as string, playerToken: token },
  };
}

/**
 * Reconnexion : retrouve la ligne tv_room_players via le token stocké.
 * Vague T (#6) — Touche juste `last_seen_at` (la presence WS reprend
 * automatiquement à la reconnexion du channel ; `is_connected` n'est
 * plus consulté).
 */
export async function rejoinRoomByToken(input: {
  code: string;
  token: string;
}): Promise<{ ok: true; data: JoinedRoom } | JoinError> {
  const room = await findActiveRoomByCode(input.code);
  if (!room) return { ok: false, message: "Partie terminée." };
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("tv_room_players")
    .select("id")
    .eq("room_id", room.id)
    .eq("player_token", input.token)
    .maybeSingle();
  if (!existing?.id) {
    return { ok: false, message: "Reconnexion impossible — rejoins manuellement." };
  }
  await supabase
    .from("tv_room_players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", existing.id as string)
    .eq("player_token", input.token);
  return {
    ok: true,
    data: {
      roomId: room.id,
      playerId: existing.id as string,
      playerToken: input.token,
    },
  };
}

/**
 * P1.1 — DEPRECATED. La présence est désormais gérée par Supabase Realtime
 * Presence (cf. tv-channel.ts). On garde ces helpers en no-op pour ne pas
 * casser les anciens callers qui n'ont pas encore migré.
 *
 * Si tu écris du nouveau code : utilise `channel.trackPresence()` /
 * `channel.untrackPresence()` au lieu de ces fonctions.
 */
export async function sendHeartbeat(_input: {
  playerId: string;
  token: string;
}): Promise<void> {
  // No-op : presence native gère le heartbeat WebSocket.
  return;
}

export async function markDisconnected(_input: {
  playerId: string;
  token: string;
}): Promise<void> {
  // No-op : presence native émet `leave` au close du socket.
  return;
}

/**
 * P1.1 — Met à jour pseudo et/ou avatar d'un joueur déjà inscrit. Appelé
 * depuis le lobby quand le joueur veut éditer ses infos avant le démarrage.
 * Protégé par `player_token` côté WHERE (équivalent du contrôle d'accès :
 * sans le token, impossible de cibler la bonne ligne).
 */
export async function updatePlayerProfile(input: {
  playerId: string;
  token: string;
  pseudo?: string;
  avatarUrl?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.pseudo !== undefined && !input.pseudo.trim()) {
    return { ok: false, message: "Le pseudo ne peut pas être vide." };
  }
  const supabase = createClient();
  const fields: { pseudo?: string; avatar_url?: string | null } = {};
  if (input.pseudo !== undefined) fields.pseudo = input.pseudo.trim();
  if (input.avatarUrl !== undefined) fields.avatar_url = input.avatarUrl;
  if (Object.keys(fields).length === 0) return { ok: true };
  const { error } = await supabase
    .from("tv_room_players")
    .update(fields)
    .eq("id", input.playerId)
    .eq("player_token", input.token);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
