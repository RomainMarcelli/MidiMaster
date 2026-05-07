"use client";

import { useEffect, useState } from "react";
import { Crown, Trophy, X as XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Animations SVG / Framer Motion (alternative locale aux Lottie).
 *
 * Avantages vs Lottie :
 *  - 0 dépendance externe (économise ~150 KB de bundle)
 *  - palette projet directement (gold / buzz / sky / life-green)
 *  - prefers-reduced-motion respecté nativement
 *  - mainenance maîtrisée (pas de .json opaque)
 *
 * Catalogue :
 *  - winner    : trophée or qui zoom + 14 confettis or qui partent en éventail
 *  - eliminated: croix rouge qui shake + halo rouge "KO"
 *  - correct   : coche verte qui pulse
 *  - wrong     : croix rouge qui shake
 *  - versus    : "VS" central avec 2 panneaux qui rentrent par les côtés
 *  - crown     : couronne or qui descend + halo
 *  - coins-rain: pluie de pièces or (parfait pour transfert de cagnotte)
 */

type AnimName =
  | "winner"
  | "eliminated"
  | "correct"
  | "wrong"
  | "versus"
  | "crown"
  | "coins-rain";

type Size = "sm" | "md" | "lg" | "fullscreen";

interface Props {
  animation: AnimName;
  size?: Size;
  /** Auto-fade après ce délai (ms). 0 = pas de timeout. */
  autoCloseMs?: number;
  /** Callback fin de l'animation (auto-close ou clic). */
  onComplete?: () => void;
  /** Pour `versus` uniquement : noms des 2 joueurs. */
  versusNames?: { left: string; right: string };
  className?: string;
}

const SIZE_PX: Record<Size, number> = {
  sm: 48,
  md: 96,
  lg: 200,
  fullscreen: 320,
};

export function AnimEffect({
  animation,
  size = "md",
  autoCloseMs = 1500,
  onComplete,
  versusNames,
  className,
}: Props) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (autoCloseMs <= 0) return;
    const t = window.setTimeout(() => setVisible(false), autoCloseMs);
    return () => window.clearTimeout(t);
  }, [autoCloseMs]);

  const px = SIZE_PX[size];
  const isFullscreen = size === "fullscreen";

  return (
    <AnimatePresence onExitComplete={onComplete}>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.25 }}
          className={cn(
            isFullscreen
              ? "pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
              : "inline-flex items-center justify-center",
            className,
          )}
          aria-hidden="true"
        >
          {animation === "winner" && <Winner size={px} reduced={!!reduced} />}
          {animation === "eliminated" && (
            <Eliminated size={px} reduced={!!reduced} />
          )}
          {animation === "correct" && <CorrectMark size={px} reduced={!!reduced} />}
          {animation === "wrong" && <WrongMark size={px} reduced={!!reduced} />}
          {animation === "versus" && (
            <Versus size={px} reduced={!!reduced} names={versusNames} />
          )}
          {animation === "crown" && <CrownAnim size={px} reduced={!!reduced} />}
          {animation === "coins-rain" && (
            <CoinsRain size={px} reduced={!!reduced} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ----------------------------------------------------------------------------
// Winner : trophée or zoom + confettis en éventail
// ----------------------------------------------------------------------------
function Winner({ size, reduced }: { size: number; reduced: boolean }) {
  const confettis = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {!reduced &&
        confettis.map((i) => {
          const angle = (i / confettis.length) * Math.PI * 2;
          const distance = size * 0.9;
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          const colors = ["#F5C518", "#FFB200", "#F5B700", "#E89E00"];
          return (
            <motion.span
              key={i}
              className="absolute left-1/2 top-1/2 h-2 w-2 rounded-sm"
              style={{
                backgroundColor: colors[i % colors.length],
                marginLeft: -4,
                marginTop: -4,
              }}
              initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
              animate={{
                x: [0, x],
                y: [0, y],
                opacity: [1, 1, 0],
                rotate: [0, 360],
              }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.1 }}
            />
          );
        })}
      <motion.div
        initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
        animate={
          reduced
            ? { scale: 1, opacity: 1, rotate: 0 }
            : { scale: [0.4, 1.2, 1], rotate: [0, -8, 4, 0], opacity: 1 }
        }
        transition={{ duration: reduced ? 0.2 : 0.7, ease: "easeOut" }}
        className="flex h-full w-full items-center justify-center rounded-full bg-gold/25 shadow-[0_0_64px_rgba(245,183,0,0.6)]"
      >
        <Trophy
          className="text-gold-warm"
          style={{ width: size * 0.55, height: size * 0.55 }}
          aria-hidden="true"
          fill="currentColor"
        />
      </motion.div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Eliminated : croix rouge qui shake + halo rouge "KO"
// ----------------------------------------------------------------------------
function Eliminated({ size, reduced }: { size: number; reduced: boolean }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={
          reduced
            ? { scale: 1, opacity: 1 }
            : { scale: [0.5, 1.2, 1], opacity: 1 }
        }
        transition={{ duration: reduced ? 0.15 : 0.45 }}
        className="flex h-full w-full items-center justify-center rounded-full bg-buzz/20 shadow-[0_0_64px_rgba(230,57,70,0.55)]"
      >
        <motion.div
          animate={reduced ? undefined : { x: [0, -8, 8, -6, 6, 0] }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-buzz"
        >
          <XIcon
            style={{ width: size * 0.6, height: size * 0.6 }}
            aria-hidden="true"
            strokeWidth={4}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Correct mark
// ----------------------------------------------------------------------------
function CorrectMark({ size, reduced }: { size: number; reduced: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={
        reduced
          ? { scale: 1, opacity: 1 }
          : { scale: [0.5, 1.15, 1], opacity: 1 }
      }
      transition={{ duration: reduced ? 0.15 : 0.4 }}
    >
      <circle cx="50" cy="50" r="45" fill="#51CF66" fillOpacity="0.18" />
      <motion.path
        d="M30 52 L46 68 L72 38"
        stroke="#51CF66"
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0.15 : 0.4, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

// ----------------------------------------------------------------------------
// Wrong mark
// ----------------------------------------------------------------------------
function WrongMark({ size, reduced }: { size: number; reduced: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={
        reduced
          ? { scale: 1, opacity: 1 }
          : { scale: [0.5, 1.15, 1], opacity: 1, x: [0, -6, 6, -4, 4, 0] }
      }
      transition={{ duration: reduced ? 0.15 : 0.5 }}
    >
      <circle cx="50" cy="50" r="45" fill="#E63946" fillOpacity="0.18" />
      <motion.line
        x1="32"
        y1="32"
        x2="68"
        y2="68"
        stroke="#E63946"
        strokeWidth="8"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0.1 : 0.25 }}
      />
      <motion.line
        x1="68"
        y1="32"
        x2="32"
        y2="68"
        stroke="#E63946"
        strokeWidth="8"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0.1 : 0.25, delay: reduced ? 0 : 0.15 }}
      />
    </motion.svg>
  );
}

// ----------------------------------------------------------------------------
// Versus : 2 panneaux qui rentrent par les côtés + "VS" central
// ----------------------------------------------------------------------------
function Versus({
  size,
  reduced,
  names,
}: {
  size: number;
  reduced: boolean;
  names?: { left: string; right: string };
}) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size * 2.4, height: size }}
    >
      {/* Panneau gauche */}
      <motion.div
        initial={{ x: reduced ? 0 : -size * 1.5, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{
          duration: reduced ? 0.2 : 0.5,
          ease: "easeOut",
          type: "spring",
          stiffness: 180,
          damping: 18,
        }}
        className="flex flex-1 items-center justify-end pr-6"
      >
        <span className="font-display text-2xl font-extrabold uppercase tracking-widest text-sky">
          {names?.left ?? "JOUEUR 1"}
        </span>
      </motion.div>

      {/* VS central */}
      <motion.div
        initial={{ scale: 0, rotate: -45, opacity: 0 }}
        animate={
          reduced
            ? { scale: 1, rotate: 0, opacity: 1 }
            : { scale: [0, 1.4, 1], rotate: [-45, 10, 0], opacity: 1 }
        }
        transition={{ duration: reduced ? 0.2 : 0.6, delay: 0.15 }}
        className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-buzz text-white shadow-[0_0_40px_rgba(230,57,70,0.6)]"
      >
        <span className="font-display text-3xl font-black">VS</span>
      </motion.div>

      {/* Panneau droit */}
      <motion.div
        initial={{ x: reduced ? 0 : size * 1.5, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{
          duration: reduced ? 0.2 : 0.5,
          ease: "easeOut",
          type: "spring",
          stiffness: 180,
          damping: 18,
        }}
        className="flex flex-1 items-center justify-start pl-6"
      >
        <span className="font-display text-2xl font-extrabold uppercase tracking-widest text-gold-warm">
          {names?.right ?? "JOUEUR 2"}
        </span>
      </motion.div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Crown : couronne or qui descend + halo
// ----------------------------------------------------------------------------
function CrownAnim({ size, reduced }: { size: number; reduced: boolean }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full bg-gold/25"
        animate={reduced ? undefined : { scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
        aria-hidden="true"
      />
      <motion.div
        initial={{ y: -size * 0.5, opacity: 0, rotate: -15 }}
        animate={
          reduced
            ? { y: 0, opacity: 1, rotate: 0 }
            : { y: [-size * 0.5, size * 0.05, 0], opacity: 1, rotate: [-15, 5, 0] }
        }
        transition={{ duration: reduced ? 0.2 : 0.7, ease: "easeOut" }}
        className="relative flex h-full w-full items-center justify-center"
      >
        <Crown
          className="text-gold-warm drop-shadow-[0_8px_20px_rgba(245,183,0,0.6)]"
          style={{ width: size * 0.7, height: size * 0.7 }}
          aria-hidden="true"
          fill="currentColor"
        />
      </motion.div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// CoinsRain : 12 pièces qui tombent + rebondissent
// ----------------------------------------------------------------------------
function CoinsRain({ size, reduced }: { size: number; reduced: boolean }) {
  const coins = Array.from({ length: 12 }, (_, i) => i);
  if (reduced) {
    // Mode reduced-motion : juste 3 pièces statiques
    return (
      <div
        className="relative flex items-center justify-center gap-2"
        style={{ width: size, height: size }}
      >
        {[0, 1, 2].map((i) => (
          <Coin key={i} px={size * 0.18} />
        ))}
      </div>
    );
  }
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {coins.map((i) => {
        const left = (i / coins.length) * 100;
        const delay = (i % 4) * 0.08;
        return (
          <motion.span
            key={i}
            className="absolute"
            style={{ left: `${left}%`, top: 0 }}
            initial={{ y: -size * 0.5, opacity: 0, rotate: 0 }}
            animate={{
              y: [
                -size * 0.5,
                size * 0.5,
                size * 0.45,
                size * 0.5,
              ],
              opacity: [0, 1, 1, 0],
              rotate: [0, 180, 360, 540],
            }}
            transition={{ duration: 1.4, delay, ease: "easeIn" }}
          >
            <Coin px={size * 0.16} />
          </motion.span>
        );
      })}
    </div>
  );
}

function Coin({ px }: { px: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#F5C518" />
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke="#C99100"
        strokeWidth="1.5"
      />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontSize="14"
        fontWeight="900"
        fill="#0B1F4D"
      >
        €
      </text>
    </svg>
  );
}
