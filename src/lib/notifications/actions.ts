"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { asJsonb } from "@/lib/supabase/jsonb";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  type NotificationSettings,
} from "./types";

/**
 * Server actions pour la persistance des préférences de notifications
 * (E4.2/E4.3). Stockées dans `profiles.notification_settings` (JSONB).
 */

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DEFAULT_NOTIFICATION_SETTINGS;

  const { data } = await supabase
    .from("profiles")
    .select("notification_settings")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return DEFAULT_NOTIFICATION_SETTINGS;
  return normalizeNotificationSettings(data.notification_settings);
}

export async function saveNotificationSettings(
  settings: NotificationSettings,
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Non connecté." };

  const normalized = normalizeNotificationSettings(settings);
  const { error } = await supabase
    .from("profiles")
    .update({ notification_settings: asJsonb(normalized) })
    .eq("id", user.id);

  if (error) return { status: "error", message: error.message };

  revalidatePath("/parametres");
  return { status: "ok" };
}
