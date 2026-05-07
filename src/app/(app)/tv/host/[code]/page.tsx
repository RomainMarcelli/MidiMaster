import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TvHostRoom } from "./tv-host-room";

export const metadata = { title: "Mode TV — Salle d'attente" };
export const dynamic = "force-dynamic";

export default async function TvHostRoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/tv/host/${code}`);

  const { data: room } = await supabase
    .from("tv_rooms")
    .select("id, code, host_id, status, game_mode, mode, created_at")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();

  if (!room) notFound();
  if (room.host_id !== user.id) {
    // Quelqu'un d'autre a essayé d'ouvrir une room qui n'est pas la sienne
    redirect("/tv/host");
  }

  // Joueurs déjà connectés (charge initial, puis Realtime prend le relais).
  // Vague T (#6) — On ne SELECT plus `is_connected` : la connectivité vient
  // exclusivement de la presence WS côté client.
  const { data: players } = await supabase
    .from("tv_room_players")
    .select("id, pseudo, avatar_url, joined_at, player_token, is_bot, bot_skill")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });

  // Vague V (#8) — Le quizPreview du carrousel TV n'est plus utilisé
  // (carrousel retiré du lobby). Si on veut un quiz d'attente, ce sera
  // côté téléphone uniquement (Vague W).

  return (
    <TvHostRoom
      roomId={room.id}
      code={room.code}
      initialPlayers={(players ?? []).map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        avatarUrl: p.avatar_url,
        // P1.1 — `is_connected` n'est plus la source de vérité. La TV
        // calcule l'état live depuis Presence ; on initialise à `false`
        // pour éviter le flash "tous en ligne" au mount avant que
        // Presence ait fait son premier sync.
        isConnected: false,
        joinedAt: p.joined_at,
        // P1.1 — token nécessaire pour cross-ref BDD ↔ Presence côté TV.
        token: p.player_token as string,
        isBot: p.is_bot,
        botSkill: p.bot_skill,
      }))}
      initialStatus={room.status as "waiting" | "playing" | "paused" | "ended"}
      roomModeKind={(room.mode as "scan" | "remote" | null) ?? "scan"}
    />
  );
}
