"use client";

import { createClient } from "@/lib/supabase/client";
import { generatePlayerToken } from "./player-actions";

/**
 * P4.1 — Actions client pour le mode "remote" (un seul téléphone régie
 * commande pour plusieurs joueurs locaux).
 *
 * Chaque joueur "remote" est créé en BDD avec `is_remote = true` et un
 * `player_token` unique stocké dans le localStorage du téléphone régie
 * (sous `mahylan-tv-remote-tokens:{code}`). Les tokens permettent ensuite
 * d'envoyer les réponses au nom du bon joueur.
 */

const REMOTE_TOKENS_KEY_PREFIX = "mahylan-tv-remote-tokens:";

export interface RemoteSlot {
  playerId: string;
  token: string;
  pseudo: string;
  avatarUrl: string | null;
}

/** Lit la liste des slots remote stockés en localStorage pour ce code. */
export function readRemoteSlots(roomCode: string): RemoteSlot[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(REMOTE_TOKENS_KEY_PREFIX + roomCode);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is RemoteSlot =>
        typeof s === "object" &&
        s !== null &&
        typeof s.playerId === "string" &&
        typeof s.token === "string" &&
        typeof s.pseudo === "string",
    );
  } catch {
    return [];
  }
}

/** Écrit la liste des slots remote en localStorage. */
export function storeRemoteSlots(roomCode: string, slots: RemoteSlot[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    REMOTE_TOKENS_KEY_PREFIX + roomCode,
    JSON.stringify(slots),
  );
}

/**
 * Crée un nouveau joueur remote (côté téléphone régie). Insère en BDD avec
 * `is_remote=true` et un token UUID, puis stocke en localStorage pour
 * permettre au régie de répondre au nom de ce joueur plus tard.
 */
export async function addRemotePlayer(input: {
  roomId: string;
  code: string;
  pseudo: string;
  avatarUrl?: string | null;
}): Promise<{ ok: true; slot: RemoteSlot } | { ok: false; message: string }> {
  if (!input.pseudo.trim()) {
    return { ok: false, message: "Le pseudo ne peut pas être vide." };
  }
  const supabase = createClient();
  const token = generatePlayerToken();
  // Vague T (#6) — On n'écrit plus `is_connected` (presence WS = source
  // de vérité). Le DEFAULT TRUE en BDD reste pour les anciens consommateurs.
  const { data, error } = await supabase
    .from("tv_room_players")
    .insert({
      room_id: input.roomId,
      player_token: token,
      pseudo: input.pseudo.trim(),
      avatar_url: input.avatarUrl ?? null,
      is_remote: true,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? "Impossible d'ajouter le joueur.",
    };
  }
  const slot: RemoteSlot = {
    playerId: data.id as string,
    token,
    pseudo: input.pseudo.trim(),
    avatarUrl: input.avatarUrl ?? null,
  };
  const slots = readRemoteSlots(input.code);
  slots.push(slot);
  storeRemoteSlots(input.code, slots);
  return { ok: true, slot };
}

/**
 * Supprime un joueur remote (côté téléphone régie). Retire la ligne BDD
 * et le slot localStorage correspondant.
 */
export async function removeRemotePlayer(input: {
  code: string;
  playerId: string;
  token: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("tv_room_players")
    .delete()
    .eq("id", input.playerId)
    .eq("player_token", input.token);
  if (error) return { ok: false, message: error.message };
  const slots = readRemoteSlots(input.code).filter(
    (s) => s.playerId !== input.playerId,
  );
  storeRemoteSlots(input.code, slots);
  return { ok: true };
}

/** Met à jour un slot remote en localStorage (après edit pseudo/avatar). */
export function updateRemoteSlot(
  roomCode: string,
  playerId: string,
  patch: Partial<Pick<RemoteSlot, "pseudo" | "avatarUrl">>,
): void {
  const slots = readRemoteSlots(roomCode).map((s) =>
    s.playerId === playerId ? { ...s, ...patch } : s,
  );
  storeRemoteSlots(roomCode, slots);
}
