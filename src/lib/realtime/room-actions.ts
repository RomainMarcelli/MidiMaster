"use server";

import { createClient } from "@/lib/supabase/server";
import { asJsonb } from "@/lib/supabase/jsonb";

/**
 * Actions Server pour gérer les rooms TV (création, lecture, mise à jour
 * d'état). Les actions joueur (join, heartbeat, answer) sont côté client
 * via `lib/realtime/tv-channel.ts` et le client supabase-js (browser).
 */

export interface CreateRoomResult {
  ok: true;
  code: string;
  roomId: string;
}
export interface CreateRoomError {
  ok: false;
  message: string;
}

/**
 * Génère un code à 4 chiffres unique parmi les rooms NON terminées.
 * Retry jusqu'à 100 fois (probabilité de collision négligeable).
 */
async function generateUniqueCode(): Promise<string | null> {
  const supabase = await createClient();
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const { data } = await supabase
      .from("tv_rooms")
      .select("id")
      .eq("code", code)
      .neq("status", "ended")
      .maybeSingle();
    if (!data) return code;
  }
  return null;
}

/**
 * Crée une nouvelle room TV pour le compte connecté. Le code à 4 chiffres
 * est garanti unique parmi les rooms actives. État initial : `waiting`.
 *
 * P4.1 — `mode` : "scan" (défaut, joueurs rejoignent par QR) ou "remote"
 * (un seul téléphone régie commande pour tous).
 */
export async function createTvRoom(input: {
  gameMode?: string;
  mode?: "scan" | "remote";
}): Promise<CreateRoomResult | CreateRoomError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Tu dois être connecté pour créer une room." };
  }

  const code = await generateUniqueCode();
  if (!code) {
    return { ok: false, message: "Impossible de générer un code unique." };
  }

  const { data, error } = await supabase
    .from("tv_rooms")
    .insert({
      code,
      host_id: user.id,
      game_mode: input.gameMode ?? "douze_coups",
      mode: input.mode ?? "scan",
      state: {},
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? "Erreur lors de la création de la room.",
    };
  }

  return { ok: true, code, roomId: data.id as string };
}

/**
 * Marque une room comme terminée (libère le code pour réutilisation).
 * N'agit que si l'utilisateur est bien l'hôte (RLS déjà l'enforce mais
 * on coupe court côté serveur).
 */
export async function endTvRoom(roomId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("tv_rooms")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", roomId)
    .eq("host_id", user.id);
}

/**
 * Met à jour l'état complet de la room (l'état du jeu sérialisé en JSON).
 * Utilisé par l'hôte pour persister la progression entre les broadcasts
 * Realtime (au cas où un téléphone se reconnecte, il peut relire l'état
 * via une requête SELECT sur tv_rooms.state).
 */
export async function updateTvRoomState(input: {
  roomId: string;
  status?: "waiting" | "playing" | "paused" | "ended";
  state?: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const update: {
    status?: "waiting" | "playing" | "paused" | "ended";
    state?: ReturnType<typeof asJsonb>;
  } = {};
  if (input.status) update.status = input.status;
  if (input.state) update.state = asJsonb(input.state);
  if (Object.keys(update).length === 0) return;

  await supabase
    .from("tv_rooms")
    .update(update)
    .eq("id", input.roomId)
    .eq("host_id", user.id);
}
