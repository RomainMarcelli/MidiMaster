"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mic, Sparkles } from "lucide-react";
import Image from "next/image";

/**
 * Vague W (#10) — Animation suspens "qui sera présentateur" en effet
 * roulette. Affichée 5s sur tous les écrans (TV + téléphones) après les
 * votes, AVANT que le face-à-face commence vraiment.
 *
 * Mécanique :
 *  - 2 avatars affichés côte à côte.
 *  - Le highlight (halo gold + scale) clignote entre les 2 avec un
 *    intervalle qui s'accélère puis se ralentit (effet roulette).
 *  - À la fin, s'arrête sur le `winnerToken` avec un halo pulsant
 *    permanent + texte "[Pseudo] est présentateur !".
 *  - Au bout de TOTAL_MS, le caller démonte le composant.
 *
 * Composant purement présentationnel. Z-index 200.
 */
const TOTAL_MS = 5000;
const STOP_AT_MS = 3500; // arrêt sur le winner après cette durée

export interface RouletteCandidate {
  token: string;
  pseudo: string;
  avatarUrl: string | null;
}

export function PresenterRouletteAnimation({
  candidates,
  winnerToken,
}: {
  candidates: [RouletteCandidate, RouletteCandidate];
  winnerToken: string;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<"spinning" | "winner">("spinning");

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    let intervalMs = 90; // rapide au début

    const tick = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= STOP_AT_MS) {
        const winnerIdx = candidates.findIndex((c) => c.token === winnerToken);
        setCurrentIdx(winnerIdx >= 0 ? winnerIdx : 0);
        setPhase("winner");
        return;
      }
      setCurrentIdx((prev) => (prev + 1) % candidates.length);
      // Ralentissement progressif après 1.8s.
      if (elapsed > 1800) intervalMs = Math.min(400, intervalMs * 1.15);
      window.setTimeout(tick, intervalMs);
    };
    window.setTimeout(tick, intervalMs);
    return () => {
      cancelled = true;
    };
  }, [candidates, winnerToken]);

  const winner = candidates.find((c) => c.token === winnerToken);

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/95 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      role="alert"
      aria-label="Tirage du présentateur"
    >
      <motion.div
        className="mb-2 flex items-center gap-2 text-gold"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <Mic className="h-6 w-6" aria-hidden="true" />
        <p className="text-2xl font-bold uppercase tracking-widest">
          Présentateur
        </p>
      </motion.div>

      <p className="mb-8 text-gold/70">
        {phase === "spinning" ? "Tirage en cours…" : ""}
      </p>

      <div className="flex items-center gap-12">
        {candidates.map((c, idx) => {
          const isHighlighted = currentIdx === idx;
          return (
            <motion.div
              key={c.token}
              className="flex flex-col items-center gap-3"
              animate={{
                scale: isHighlighted ? 1.1 : 0.9,
                opacity: isHighlighted ? 1 : 0.5,
              }}
              transition={{ duration: 0.1 }}
            >
              <div
                className={
                  "relative h-44 w-44 overflow-hidden rounded-full border-8 " +
                  (isHighlighted ? "border-gold" : "border-foreground/20")
                }
              >
                {c.avatarUrl ? (
                  <Image
                    src={c.avatarUrl}
                    alt=""
                    width={176}
                    height={176}
                    unoptimized
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-foreground/30" />
                )}
                {phase === "winner" && isHighlighted && (
                  <motion.div
                    className="absolute inset-0 bg-gold/30"
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <p
                className={
                  "font-display text-2xl font-extrabold " +
                  (isHighlighted ? "text-gold" : "text-foreground/40")
                }
              >
                {c.pseudo}
              </p>
            </motion.div>
          );
        })}
      </div>

      {phase === "winner" && winner && (
        <motion.div
          className="mt-8 flex items-center gap-3"
          initial={{ scale: 0, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200 }}
        >
          <Sparkles className="h-8 w-8 text-gold" aria-hidden="true" />
          <p
            className="font-display text-4xl font-black text-gold"
            style={{ textShadow: "0 0 40px rgba(245,183,0,0.8)" }}
          >
            {winner.pseudo} présente !
          </p>
          <Sparkles className="h-8 w-8 text-gold" aria-hidden="true" />
        </motion.div>
      )}
    </motion.div>
  );
}

PresenterRouletteAnimation.TOTAL_MS = TOTAL_MS;
