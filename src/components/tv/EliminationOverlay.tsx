"use client";

import { motion } from "framer-motion";
import { Skull } from "lucide-react";
import Image from "next/image";

/**
 * Vague R — Overlay full-screen affiché 4-5s entre 2 phases du Mode TV
 * (Coup d'Envoi → Coup par Coup → Face-à-Face). Annonce le joueur
 * éliminé + la prochaine étape.
 *
 * Utilisé côté TV (en grand) et côté téléphone éliminé (en plus petit
 * mais même contenu) pour ne pas désorienter.
 */
export function EliminationOverlay({
  visible,
  pseudo,
  avatarUrl,
  fromPhase,
  nextPhase,
}: {
  visible: boolean;
  pseudo: string;
  avatarUrl: string | null;
  fromPhase: "coup-envoi" | "coup-par-coup";
  nextPhase: "coup-par-coup" | "face-a-face";
}) {
  if (!visible) return null;

  const nextLabel =
    nextPhase === "coup-par-coup"
      ? "Coup par Coup"
      : "Face-à-Face";
  const fromLabel =
    fromPhase === "coup-envoi" ? "Coup d'Envoi" : "Coup par Coup";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex flex-col items-center justify-center gap-6 bg-foreground/90 p-6 text-center backdrop-blur-md"
      role="dialog"
      aria-live="assertive"
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 20 }}
        className="flex flex-col items-center gap-4"
      >
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-buzz">
          Fin de la phase {fromLabel}
        </p>
        <div className="relative">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={200}
              height={200}
              className="h-40 w-40 rounded-3xl border-4 border-buzz object-cover shadow-[0_0_64px_rgba(206,31,67,0.7)] sm:h-48 sm:w-48"
              unoptimized
            />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-3xl border-4 border-buzz bg-buzz/30 shadow-[0_0_64px_rgba(206,31,67,0.7)] sm:h-48 sm:w-48">
              <Skull className="h-20 w-20 text-buzz" aria-hidden="true" />
            </div>
          )}
        </div>
        <p className="font-display text-5xl font-extrabold uppercase tracking-wider text-background sm:text-6xl">
          {pseudo}
        </p>
        <p className="font-display text-2xl font-bold uppercase tracking-widest text-buzz">
          est éliminé
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.4 }}
        className="rounded-2xl border border-gold/40 bg-gold/15 px-6 py-3"
      >
        <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
          Prochaine étape
        </p>
        <p className="font-display text-xl font-extrabold text-background sm:text-2xl">
          {nextLabel}
        </p>
      </motion.div>
    </motion.div>
  );
}
