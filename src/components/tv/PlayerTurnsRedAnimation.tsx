"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import Image from "next/image";

/**
 * Vague V (#3) — Animation cinématique "passage au rouge" plein écran.
 *
 * Affichée 3s sur tous les écrans (TV + téléphones) quand un joueur tombe
 * au rouge, AVANT l'animation `<DuelAnnouncementAnimation />` puis la page
 * de choix de candidat.
 *
 * Composant purement présentationnel — c'est le caller qui démonte après
 * 3s (timer côté host + listener côté phone). Z-index 200 pour passer
 * au-dessus de toutes les vues.
 */
export function PlayerTurnsRedAnimation({
  pseudo,
  avatarUrl,
}: {
  pseudo: string;
  avatarUrl: string | null;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      role="alert"
      aria-label={`${pseudo} passe au rouge`}
    >
      <motion.div
        className="relative"
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.2, 1] }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <motion.div
          className="absolute inset-0 rounded-full bg-buzz/40 blur-3xl"
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          aria-hidden="true"
        />
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={200}
            height={200}
            unoptimized
            className="relative rounded-full border-8 border-buzz"
          />
        ) : (
          <div className="relative h-[200px] w-[200px] rounded-full border-8 border-buzz bg-foreground/20" />
        )}
        <AlertTriangle
          className="absolute -right-4 -top-4 h-16 w-16 fill-buzz/30 text-buzz"
          aria-hidden="true"
        />
      </motion.div>

      <motion.h1
        className="mt-8 text-center font-display text-6xl font-black text-buzz"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        style={{ textShadow: "0 0 40px rgba(206,31,67,0.8)" }}
      >
        {pseudo}
      </motion.h1>
      <motion.p
        className="mt-2 text-3xl font-bold text-buzz/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        passe au ROUGE !
      </motion.p>
    </motion.div>
  );
}
