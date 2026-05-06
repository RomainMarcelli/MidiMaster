"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/admin-guard";

/**
 * Server actions pour la gestion admin des utilisateurs (F3.1).
 *
 * Sécurité : chaque action commence par `requireAdmin()` qui redirige
 * si l'appelant n'est pas admin. On utilise ensuite le service_role
 * pour les opérations cross-user.
 */

export interface AdminUserRow {
  id: string;
  pseudo: string | null;
  email: string;
  role: "user" | "admin";
  avatar_url: string | null;
  xp: number;
  niveau: number;
  /** Nombre de parties tirées de game_sessions (calculé). */
  games_played: number;
  /** Dernière partie ou activité (calculé via game_sessions). */
  last_seen_at: string | null;
  created_at: string;
}

export type UserSortKey =
  | "created_at"
  | "last_seen_at"
  | "games_played"
  | "xp"
  | "pseudo";

export type UserFilter = "all" | "admins" | "users" | "inactive";

export async function fetchAllUsers(opts: {
  search?: string;
  filter?: UserFilter;
  sort?: UserSortKey;
  sortDir?: "asc" | "desc";
}): Promise<{ status: "ok"; users: AdminUserRow[] } | { status: "error"; message: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  const search = (opts.search ?? "").trim().toLowerCase();
  const filter = opts.filter ?? "all";
  const sort = opts.sort ?? "last_seen_at";
  const dir = opts.sortDir ?? "desc";

  // 1. Récupère tous les profils (colonnes effectivement présentes)
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, pseudo, role, avatar_url, xp, niveau, created_at");
  if (pErr) return { status: "error", message: pErr.message };

  // 2. Récupère les stats de game_sessions par user (count + dernière)
  // pour les colonnes "games_played" et "last_seen_at".
  const gamesByUser = new Map<
    string,
    { count: number; lastAt: string | null }
  >();
  try {
    const { data: sessions } = await admin
      .from("game_sessions")
      .select("user_id, created_at")
      .returns<Array<{ user_id: string; created_at: string }>>();
    for (const s of sessions ?? []) {
      const cur = gamesByUser.get(s.user_id) ?? { count: 0, lastAt: null };
      cur.count += 1;
      if (!cur.lastAt || s.created_at > cur.lastAt) cur.lastAt = s.created_at;
      gamesByUser.set(s.user_id, cur);
    }
  } catch {
    // Table absente ou autre — on continue sans les stats.
  }

  // 3. Récupère les emails via auth.admin.listUsers (paginé)
  const emailsById = new Map<string, string>();
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) break;
    if (!data || data.users.length === 0) break;
    for (const u of data.users) {
      if (u.email) emailsById.set(u.id, u.email);
    }
    if (data.users.length < 1000) break;
    page += 1;
  }

  // 4. Merge + filter + sort
  const now = Date.now();
  const inactiveCutoffMs = 30 * 24 * 60 * 60 * 1000;

  const merged: AdminUserRow[] = (profiles ?? []).map((p) => {
    const stats = gamesByUser.get(p.id);
    return {
      id: p.id,
      pseudo: p.pseudo ?? null,
      email: emailsById.get(p.id) ?? "(email indisponible)",
      role: (p.role ?? "user") as "user" | "admin",
      avatar_url: p.avatar_url ?? null,
      xp: p.xp ?? 0,
      niveau: p.niveau ?? 1,
      games_played: stats?.count ?? 0,
      last_seen_at: stats?.lastAt ?? null,
      created_at: p.created_at ?? new Date(0).toISOString(),
    };
  });

  let filtered = merged;
  if (search) {
    filtered = filtered.filter(
      (u) =>
        u.pseudo?.toLowerCase().includes(search) ||
        u.email.toLowerCase().includes(search),
    );
  }
  if (filter === "admins") filtered = filtered.filter((u) => u.role === "admin");
  else if (filter === "users") filtered = filtered.filter((u) => u.role === "user");
  else if (filter === "inactive") {
    filtered = filtered.filter((u) => {
      if (!u.last_seen_at) return true;
      return now - new Date(u.last_seen_at).getTime() > inactiveCutoffMs;
    });
  }

  filtered.sort((a, b) => {
    const factor = dir === "asc" ? 1 : -1;
    switch (sort) {
      case "pseudo":
        return factor * (a.pseudo ?? "").localeCompare(b.pseudo ?? "");
      case "created_at":
        return (
          factor *
          (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        );
      case "last_seen_at": {
        const av = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
        const bv = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
        return factor * (av - bv);
      }
      case "games_played":
        return factor * (a.games_played - b.games_played);
      case "xp":
        return factor * (a.xp - b.xp);
    }
  });

  return { status: "ok", users: filtered };
}

/**
 * Met à jour le rôle d'un utilisateur. Refus :
 *   - L'admin connecté ne peut pas se rétrograder lui-même.
 */
export async function updateUserRole(
  userId: string,
  newRole: "user" | "admin",
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const { user: caller } = await requireAdmin();
  if (caller.id === userId && newRole !== "admin") {
    return {
      status: "error",
      message: "Tu ne peux pas te rétrograder toi-même.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: newRole })
    .eq("id", userId);

  if (error) return { status: "error", message: error.message };
  revalidatePath("/admin/users");
  return { status: "ok" };
}

/**
 * Supprime un utilisateur (auth.users + cascade vers profiles).
 * Refus : l'admin connecté ne peut pas se supprimer lui-même.
 */
export async function deleteUserAccount(
  userId: string,
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const { user: caller } = await requireAdmin();
  if (caller.id === userId) {
    return {
      status: "error",
      message: "Tu ne peux pas supprimer ton propre compte.",
    };
  }

  const admin = createAdminClient();
  // L'API admin supprime auth.users — la cascade FK supprime profiles
  // et tout ce qui dépend du user.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/users");
  return { status: "ok" };
}
