"use client";

import { motion } from "framer-motion";
import { Swords } from "lucide-react";

/**
 * Vague V (#3) — Animation cinématique "Qui dit rouge dit DUEL" plein écran.
 *
 * Affichée 3s sur tous les écrans (TV + téléphones) APRÈS la
 * `<PlayerTurnsRedAnimation />`, et AVANT la page de choix de candidat.
 *
 * Composant purement présentationnel — démonté par le caller après 3s.
 */
export function DuelAnnouncementAnimation() {
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-navy via-black to-navy"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      role="alert"
      aria-label="Duel imminent"
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute h-96 w-96 rounded-full bg-gold/20 blur-3xl"
          animate={{
            scale: [0, 2, 0],
            opacity: [0, 0.6, 0],
          }}
          transition={{
            duration: 2,
            delay: i * 0.4,
            repeat: Infinity,
          }}
          style={{
            left: `${20 + i * 30}%`,
            top: `${30 + i * 10}%`,
          }}
          aria-hidden="true"
        />
      ))}

      <motion.p
        className="mb-4 text-3xl font-bold text-gold/80"
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        Qui dit rouge dit
      </motion.p>

      <motion.div
        className="flex items-center gap-6"
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{
          type: "spring",
          stiffness: 200,
          delay: 0.6,
        }}
      >
        <Swords className="h-24 w-24 text-gold" aria-hidden="true" />
        <h1
          className="font-display text-9xl font-black tracking-tight text-gold"
          style={{ textShadow: "0 0 80px rgba(245,197,24,0.8)" }}
        >
          DUEL
        </h1>
        <Swords className="h-24 w-24 -scale-x-100 text-gold" aria-hidden="true" />
      </motion.div>

      <motion.div
        className="pointer-events-none absolute inset-0"
        animate={{
          background: [
            "radial-gradient(circle at center, rgba(245,197,24,0.2) 0%, transparent 50%)",
            "radial-gradient(circle at center, rgba(245,197,24,0.4) 0%, transparent 50%)",
            "radial-gradient(circle at center, rgba(245,197,24,0.2) 0%, transparent 50%)",
          ],
        }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 1 }}
        aria-hidden="true"
      />
    </motion.div>
  );
}
