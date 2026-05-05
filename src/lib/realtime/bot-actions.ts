"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  BOT_ROOM_LIMITS,
  clampBotSkill,
  computeNextBotPseudo,
  validateBotAdd,
  validateBotRemove,
} from "./bot-actions-helpers";

/**
 * Vague S3 — Server actions pour gérer les bots IA dans une room TV.
 *
 * Les bots sont des lignes `tv_room_players` avec `is_bot = true`. Ils
 * apparaissent comme des joueurs normaux pour le moteur de jeu (mêmes
 * tokens, même cycle de vie), mais leurs **réponses sont simulées
 * côté client TV** (orchestrateur `TvDouzeCoupsHost`) via setTimeout +
 * Math.random < bot_skill / 100.
 *
 * Le préfixe `bot:` du token sert à distinguer rapidement bots et
 * humains côté client (pas de fetch supplémentaire requis).
 *
 * La logique pure de validation + génération de pseudo est extraite dans
 * `bot-actions-helpers.ts` pour pouvoir être testée unitairement.
 */

interface AddBotResult {
  ok: true;
  bot: {
    id: string;
    token: string;
    pseudo: string;
    avatarUrl: string | null;
    botSkill: number;
  };
}
interface ActionError {
  ok: false;
  message: string;
}

/**
 * Ajoute un bot à la room. Vérifie que :
 *  - L'utilisateur est l'hôte de la room
 *  - La room est en lobby (status='waiting')
 *  - Il y a moins de 8 joueurs (limite hard)
 *
 * Le pseudo est généré "Bot N" où N = nombre de bots existants + 1.
 * Le bot_skill est paramétrable (défaut 70 = 70% de bonnes réponses).
 */
export async function addBotToRoom(input: {
  roomId: string;
  botSkill?: number;
}): Promise<AddBotResult | ActionError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Non authentifié." };

  const { data: room } = await supabase
    .from("tv_rooms")
    .select("id, host_id, status")
    .eq("id", input.roomId)
    .maybeSingle();
  if (!room || room.host_id !== user.id) {
    return { ok: false, message: "Room introuvable ou non autorisée." };
  }

  const { data: existing } = await supabase
    .from("tv_room_players")
    .select("id, player_token")
    .eq("room_id", input.roomId);
  const existingArr = (existing ?? []) as unknown as Array<{
    id: string;
    is_bot?: boolean;
    player_token: string;
  }>;

  // Validation pure (status + nombre joueurs)
  const validation = validateBotAdd(room.status, existingArr.length);
  if (!validation.ok) return validation;

  const pseudo = computeNextBotPseudo(existingArr);
  const token = `bot:${randomUUID()}`;
  const skill = clampBotSkill(input.botSkill ?? BOT_ROOM_LIMITS.DEFAULT_SKILL);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: any = {
    room_id: input.roomId,
    player_token: token,
    pseudo,
    avatar_url: null,
    is_bot: true,
    bot_skill: skill,
  };
  const { data, error } = await supabase
    .from("tv_room_players")
    .insert(insertPayload)
    .select("id, player_token, pseudo, avatar_url")
    .single();
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Erreur insertion bot." };
  }
  return {
    ok: true,
    bot: {
      id: data.id,
      token: data.player_token,
      pseudo: data.pseudo,
      avatarUrl: data.avatar_url,
      botSkill: skill,
    },
  };
}

/**
 * Supprime un bot de la room. Vérifie l'host + que la cible est bien
 * un bot (sécurité : pas moyen de kicker un humain via cette action).
 */
export async function removeBotFromRoom(input: {
  roomId: string;
  botToken: string;
}): Promise<{ ok: true } | ActionError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Non authentifié." };

  const { data: room } = await supabase
    .from("tv_rooms")
    .select("id, host_id, status")
    .eq("id", input.roomId)
    .maybeSingle();
  if (!room || room.host_id !== user.id) {
    return { ok: false, message: "Room introuvable ou non autorisée." };
  }

  const validation = validateBotRemove(room.status, input.botToken);
  if (!validation.ok) return validation;

  // is_bot vérifié via le préfixe "bot:" du token (filtre côté code).
  // On ne filtre pas la query Supabase sur is_bot car les types générés
  // ne connaissent pas encore la colonne.
  const { error } = await supabase
    .from("tv_room_players")
    .delete()
    .eq("room_id", input.roomId)
    .eq("player_token", input.botToken);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

