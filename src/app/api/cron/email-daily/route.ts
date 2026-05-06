import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { getBuildBrand } from "@/lib/build-brand";
import { devLog } from "@/lib/dev-log";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  type NotificationSettings,
} from "@/lib/notifications/types";
import { buildDailyReminderEmail } from "@/lib/notifications/email-template";

/**
 * Cron quotidien — déclenché par Vercel Cron toutes les heures (cf.
 * `vercel.json`). Pour chaque user dont les notifs mail sont activées
 * et l'horaire correspond à l'heure courante (UTC, à ajuster côté
 * settings si besoin), on envoie un mail s'il n'a pas joué aujourd'hui.
 *
 * Sécurité : la route exige le bearer `CRON_SECRET` (défini dans Vercel
 * → ENV). Vercel Cron envoie automatiquement ce header.
 *
 * Variables d'environnement requises (Vercel + .env.local) :
 *   - RESEND_API_KEY              : clé API Resend
 *   - RESEND_FROM_EMAIL           : ex "Mahylan <noreply@mahylan.com>"
 *   - CRON_SECRET                 : token aléatoire pour authentifier le cron
 *   - NEXT_PUBLIC_SUPABASE_URL    : URL Supabase (déjà présent côté app)
 *   - SUPABASE_SERVICE_ROLE_KEY   : clé service-role (à créer si absente)
 *   - NEXT_PUBLIC_APP_URL         : URL publique de l'app (ex "https://mahylan.com")
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  pseudo: string | null;
  email: string;
  notification_settings: unknown;
}

interface PlayedTodayRow {
  user_id: string;
}

export async function GET(req: NextRequest) {
  // 1. Auth : Vercel Cron envoie le bearer du secret
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // O4 — Garde-fou multi-déploiement : si le build n'est pas le
  // déploiement public générique, on skip pour éviter les doublons
  // (ex. 2 mails envoyés au même user, un par déploiement). Les 2
  // déploiements partagent la même BDD Supabase ; on ne veut pas que
  // le déploiement Mahylan exécute aussi les crons.
  const brand = getBuildBrand();
  if (brand.mode !== "generic") {
    devLog("[cron:email-daily] skipped on non-generic deployment:", {
      brand: brand.mode,
    });
    return NextResponse.json({
      skipped: true,
      reason: `cron disabled on this deployment (BRAND_MODE=${brand.mode})`,
    });
  }

  // 2. Variables Resend / Supabase
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://mahylan.com";
  if (!apiKey || !fromEmail || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing env (RESEND_API_KEY/FROM_EMAIL/SERVICE_ROLE)" },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);
  // Service-role client pour bypass RLS sur les SELECT cross-user
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const now = new Date();
  // On compare en heure locale Europe/Paris pour matcher l'attente du user
  // (heure affichée dans son time picker = heure locale française).
  const parisFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parisHHMM = parisFormatter.format(now); // ex "18:00"
  const parisDayFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
  });
  const dayName = parisDayFormatter.format(now).toLowerCase();
  const dayMap: Record<string, number> = {
    dimanche: 0,
    lundi: 1,
    mardi: 2,
    mercredi: 3,
    jeudi: 4,
    vendredi: 5,
    samedi: 6,
  };
  const todayDayIdx = dayMap[dayName] ?? 1;
  const todayIso = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }),
  )
    .toISOString()
    .slice(0, 10);

  // 3. SELECT les profiles potentiellement concernés
  // Filtre côté JS pour matcher l'heure exacte (le JSONB ne se filtre pas
  // facilement par sous-clé en PostgREST).
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, pseudo, notification_settings")
    .returns<
      Array<{
        id: string;
        pseudo: string | null;
        notification_settings: unknown;
      }>
    >();
  if (profilesErr) {
    return NextResponse.json(
      { error: "DB error: " + profilesErr.message },
      { status: 500 },
    );
  }

  const candidates = (profiles ?? []).filter((p) => {
    const s: NotificationSettings = normalizeNotificationSettings(
      p.notification_settings ?? DEFAULT_NOTIFICATION_SETTINGS,
    );
    if (!s.email_daily) return false;
    if (!s.email_days.includes(todayDayIdx)) return false;
    if (s.email_time !== parisHHMM) return false;
    return true;
  });

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      message: `No candidate at ${parisHHMM} (${dayName})`,
    });
  }

  // 4. Récupère les emails (auth.users) — on a besoin du service-role
  // pour interroger auth.users (même schema, mais protégé).
  // Approche : on liste les users via admin API, on map par id.
  const candidateIds = new Set(candidates.map((c) => c.id));
  const emailsById = new Map<string, string>();
  // L'API admin pagine par 1000 par défaut.
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) break;
    if (!data || data.users.length === 0) break;
    for (const u of data.users) {
      if (candidateIds.has(u.id) && u.email) {
        emailsById.set(u.id, u.email);
      }
    }
    if (data.users.length < 1000) break;
    page += 1;
  }

  // 5. Filtre ceux qui ont déjà joué aujourd'hui (table `game_plays`,
  // `game_history`, ou autre — on tente plusieurs noms standards et on
  // continue silencieusement si la table n'existe pas).
  let playedToday = new Set<string>();
  try {
    // `game_history` n'est pas dans le schéma TS (table optionnelle —
     // peut ne pas exister selon l'environnement). On la requête de façon
     // défensive avec un cast `as never` qui désactive le check sur le
     // nom de table.
    const { data: plays } = await supabase
      .from("game_history" as never)
      .select("user_id")
      .gte("created_at", `${todayIso}T00:00:00Z`)
      .returns<PlayedTodayRow[]>();
    if (plays) playedToday = new Set(plays.map((p) => p.user_id));
  } catch {
    // table absente → on n'exclut personne
  }

  const sendable: UserRow[] = candidates
    .filter((c) => emailsById.has(c.id) && !playedToday.has(c.id))
    .map((c) => ({
      id: c.id,
      pseudo: c.pseudo,
      email: emailsById.get(c.id)!,
      notification_settings: c.notification_settings,
    }));

  // 6. Envoie en série (pour ne pas saturer Resend en cas de gros lot)
  let sent = 0;
  let errors = 0;
  for (const u of sendable) {
    const { subject, html, text } = buildDailyReminderEmail({
      pseudo: u.pseudo ?? "champion",
      appUrl,
    });
    try {
      await resend.emails.send({
        from: fromEmail,
        to: u.email,
        subject,
        html,
        text,
      });
      sent += 1;
    } catch {
      errors += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    sent,
    errors,
    parisTime: parisHHMM,
    day: dayName,
  });
}
