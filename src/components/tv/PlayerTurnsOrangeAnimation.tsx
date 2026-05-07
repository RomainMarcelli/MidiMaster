"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import Image from "next/image";

/**
 * Vague W (#9) — Animation cinématique "passage au orange" plein écran.
 *
 * Affichée 3s sur tous les écrans (TV + téléphones) quand un joueur passe
 * de vert à orange (1ère erreur). Pas de duel à ce stade — juste un
 * warning : "plus qu'une chance avant le rouge".
 *
 * Composant purement présentationnel — démonté par le caller après 3s.
 * Z-index 200 pour passer au-dessus de toutes les vues.
 */
export function PlayerTurnsOrangeAnimation({
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
      aria-label={`${pseudo} passe au orange`}
    >
      <motion.div
        className="relative"
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.2, 1] }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <motion.div
          className="absolute inset-0 rounded-full bg-gold-warm/40 blur-3xl"
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
            className="relative rounded-full border-8 border-gold-warm"
          />
        ) : (
          <div className="relative h-[200px] w-[200px] rounded-full border-8 border-gold-warm bg-foreground/20" />
        )}
        <AlertCircle
          className="absolute -right-4 -top-4 h-16 w-16 fill-gold-warm/30 text-gold-warm"
          aria-hidden="true"
        />
      </motion.div>

      <motion.h1
        className="mt-8 text-center font-display text-6xl font-black text-gold-warm"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        style={{ textShadow: "0 0 40px rgba(232,158,0,0.8)" }}
      >
        {pseudo}
      </motion.h1>
      <motion.p
        className="mt-2 text-3xl font-bold text-gold-warm/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        passe au ORANGE
      </motion.p>
      <motion.p
        className="mt-2 text-lg text-gold-warm/70"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
      >
        Plus qu&apos;une chance avant le rouge !
      </motion.p>
    </motion.div>
  );
}
