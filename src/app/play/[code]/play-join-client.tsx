"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Crown,
  Loader2,
  LogIn,
  Smartphone,
  Tv,
  WifiOff,
  X,
} from "lucide-react";
import Image from "next/image";
import { AvatarPicker } from "@/components/avatars/AvatarPicker";
import { Button } from "@/components/ui/button";
import {
  joinRoom,
  readStoredToken,
  rejoinRoomByToken,
} from "@/lib/realtime/player-actions";
import { cn } from "@/lib/utils";

interface PlayJoinClientProps {
  code: string;
  roomFound: boolean;
  initialStatus: "waiting" | "playing" | "paused" | null;
  /** P4.1 — Mode de la room : "scan" (défaut) ou "remote" (régie unique). */
  roomMode: "scan" | "remote";
}

type Mode = "light" | "full";

/**
 * Formulaire de jonction côté téléphone. Sans auth — tout passe via les
 * policies publiques INSERT/UPDATE de tv_room_players, sécurisé par le
 * `player_token` stocké en localStorage.
 *
 * Si on a déjà un token en local pour ce code → tentative de reconnexion
 * automatique au mount, redirect vers /play/[code]/light ou /play/[code]
 * selon le mode précédemment choisi (mémorisé en localStorage).
 */
export function PlayJoinClient({
  code,
  roomFound,
  initialStatus,
  roomMode,
}: PlayJoinClientProps) {
  const router = useRouter();
  const [pseudo, setPseudo] = useState("");
  const [mode, setMode] = useState<Mode>("light");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // P4.1 — Si la room est en mode "remote", on redirige vers le client régie.
  // Pas de jonction par pseudo : le téléphone régie crée les joueurs depuis
  // son écran.
  useEffect(() => {
    if (!roomFound) return;
    if (roomMode === "remote") {
      router.replace(`/play/${code}/remote`);
    }
  }, [roomFound, roomMode, router, code]);

  // Tentative de reconnexion automatique si on a un token en localStorage.
  useEffect(() => {
    if (!roomFound) return;
    if (roomMode === "remote") return; // pas de reconnexion auto en mode régie
    const token = readStoredToken(code);
    if (!token) return;
    setReconnecting(true);
    void rejoinRoomByToken({ code, token })
      .then((res) => {
        if (res.ok) {
          // Garde le mode du dernier passage si présent, sinon "light".
          const m =
            (window.localStorage.getItem(`mahylan-tv-mode:${code}`) as Mode) ??
            "light";
          router.push(m === "full" ? `/play/${code}/full` : `/play/${code}/light`);
        } else {
          setReconnecting(false);
        }
      })
      .catch(() => setReconnecting(false));
  }, [code, roomFound, roomMode, router]);

  async function handleJoin() {
    if (!pseudo.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await joinRoom({ code, pseudo, avatarUrl });
    if (!res.ok) {
      setError(res.message);
      setSubmitting(false);
      return;
    }
    // Mémorise le mode pour la reconnexion auto
    window.localStorage.setItem(`mahylan-tv-mode:${code}`, mode);
    router.push(mode === "full" ? `/play/${code}/full` : `/play/${code}/light`);
  }

  if (!roomFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-buzz/15 text-buzz">
          <WifiOff className="h-10 w-10" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-extrabold text-foreground">
          Code invalide
        </h1>
        <p className="max-w-xs text-foreground/60">
          Le code <strong>{code}</strong> ne correspond à aucune partie en
          cours. Vérifie auprès de l&apos;hôte.
        </p>
      </main>
    );
  }

  if (reconnecting) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-gold-warm" aria-hidden="true" />
        <p className="text-foreground/70">Reconnexion à la partie {code}…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-background p-5">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/20 text-gold-warm">
          <Tv className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
            Partie {code}
          </p>
          <h1 className="font-display text-xl font-extrabold text-foreground">
            Rejoindre la soirée
          </h1>
        </div>
      </header>

      {initialStatus && initialStatus !== "waiting" && (
        <div
          role="status"
          className="rounded-xl border border-sky/40 bg-sky/10 px-4 py-2 text-sm text-foreground"
        >
          La partie a déjà commencé — tu rejoindras en cours.
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Choisir un avatar"
            className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-gold/10 transition-colors hover:border-gold hover:bg-gold/20"
          >
            {avatarUrl ? (
              <>
                <Image
                  src={avatarUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                  unoptimized
                />
                <span className="absolute inset-x-0 bottom-0 bg-foreground/70 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-background">
                  Modifier
                </span>
              </>
            ) : (
              <Camera className="h-6 w-6 text-gold-warm" aria-hidden="true" />
            )}
          </button>
          <input
            type="text"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            placeholder="Ton pseudo"
            maxLength={20}
            className="h-12 flex-1 rounded-xl border border-border bg-card px-4 text-lg font-semibold text-foreground focus:border-gold focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-foreground/50">
            Avatar : choisis dans le pack, prends une photo, ou importe.
          </p>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/60 hover:text-buzz"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Retirer
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-foreground/50">
          Mode d&apos;affichage
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            icon={Smartphone}
            title="Light"
            desc="Juste les boutons A/B/C/D — recommandé"
            selected={mode === "light"}
            onClick={() => setMode("light")}
          />
          <ModeCard
            icon={Crown}
            title="Complet"
            desc="Avec la question + explications"
            selected={mode === "full"}
            onClick={() => setMode("full")}
          />
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-buzz/40 bg-buzz/10 px-4 py-2 text-sm text-buzz"
        >
          {error}
        </p>
      )}

      <Button
        variant="gold"
        size="lg"
        disabled={!pseudo.trim() || submitting}
        onClick={handleJoin}
        className="text-lg"
      >
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="h-5 w-5" aria-hidden="true" />
        )}
        Rejoindre
      </Button>

      {/* Modal avatar : Pack DiceBear / Custom (admin) / Aléatoire /
          Photo / Upload. `uploadBucket` "saved-players-avatars" est public
          en INSERT (cf. RLS).
          Vague U (#4) — `hideCustomTab` retiré : les guests peuvent
          maintenant lire `custom_avatars` (cf. migration 0020). */}
      <AvatarPicker
        open={pickerOpen}
        currentUrl={avatarUrl}
        onClose={() => setPickerOpen(false)}
        onPick={(url) => setAvatarUrl(url)}
        uploadBucket="saved-players-avatars"
        uploadPath="guest"
      />
    </main>
  );
}

function ModeCard({
  icon: Icon,
  title,
  desc,
  selected,
  onClick,
}: {
  icon: typeof Tv;
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-center transition-colors",
        selected
          ? "border-gold bg-gold/10"
          : "border-border bg-card hover:border-gold/50",
      )}
    >
      <Icon className="h-5 w-5 text-gold-warm" aria-hidden="true" />
      <p className="font-display text-sm font-bold text-foreground">{title}</p>
      <p className="text-[11px] text-foreground/60">{desc}</p>
    </button>
  );
}
