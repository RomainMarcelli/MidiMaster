"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DoorOpen, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Q3.1 — Overlay full-screen affiché côté joueur quand l'hôte ferme la
 * partie (event Realtime `room:closed`). Countdown 5s visible + bouton
 * manuel pour rejoindre une nouvelle partie immédiatement.
 *
 * La redirection cible `/play` (formulaire de saisie de code, pas un code
 * spécifique).
 *
 * Utilisé par play-light-client, play-remote-client et play-face-a-face-view.
 */
export function RoomClosedOverlay({
  visible,
  redirectMs = 5000,
}: {
  visible: boolean;
  redirectMs?: number;
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(Math.ceil(redirectMs / 1000));

  useEffect(() => {
    if (!visible) return;
    setRemaining(Math.ceil(redirectMs / 1000));
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, Math.ceil((redirectMs - elapsed) / 1000));
      setRemaining(left);
      if (elapsed >= redirectMs) {
        window.clearInterval(interval);
        router.replace("/play");
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [visible, redirectMs, router]);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-closed-title"
      // Vague U (#7) — Couleurs sémantiques (background/foreground) pour
      // que l'overlay respecte le thème light/dark de l'app. Avant on
      // utilisait `bg-foreground/85` + `text-background` qui forçait le
      // fond sombre + texte clair en toutes circonstances.
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background/95 p-6 text-center text-foreground backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex h-20 w-20 items-center justify-center rounded-3xl bg-buzz/20 text-buzz"
      >
        <DoorOpen className="h-10 w-10" aria-hidden="true" />
      </motion.div>

      <div className="flex flex-col gap-2">
        <h1
          id="room-closed-title"
          className="font-display text-2xl font-extrabold uppercase tracking-wider text-foreground sm:text-3xl"
        >
          Partie fermée par l&apos;hôte
        </h1>
        <p className="max-w-sm text-base text-foreground/70">
          La partie a été terminée. Tu peux rejoindre une nouvelle partie
          en cliquant ci-dessous.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button
          variant="gold"
          size="lg"
          onClick={() => router.replace("/play")}
        >
          <LogIn className="h-5 w-5" aria-hidden="true" />
          Rejoindre une nouvelle partie
        </Button>
        <p className="text-sm font-semibold text-foreground/60">
          Redirection automatique dans{" "}
          <span className="text-gold-warm">{remaining}</span>s
        </p>
      </div>
    </motion.div>
  );
}
