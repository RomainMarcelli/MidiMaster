"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Heart, Skull } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type {
  DcPlayer,
  LifeStatus,
} from "@/lib/realtime/tv-douze-coups-state";
import {
  lifeBorderClass,
  lifeShadowClass,
  shouldFlashOnLifeChange,
} from "./life-card-helpers";

/**
 * Vague S6 — Card joueur affichée sur la TV pendant le mode 12 Coups.
 * Affiche :
 *  - Avatar + pseudo
 *  - Bordure colorée selon l'état de vie (vert / orange / rouge)
 *  - 2 cœurs qui reflètent les vies restantes
 *  - Highlight (ring gold + scale légère) sur le joueur courant
 *  - Animation **flash** de 800 ms quand le statut de vie change
 *    (vert → orange ou orange → rouge), pour signaler visuellement
 *    la perte de vie
 *  - Overlay grisé + ☠️ sur les éliminés (avec rang d'élimination
 *    affiché si fourni)
 */
export function TvPlayerLifeCard({
  player,
  isCurrent,
  size = "md",
}: {
  player: DcPlayer;
  isCurrent: boolean;
  size?: "sm" | "md";
}) {
  const lifeBorder = lifeBorderClass(player.lifeStatus, player.isEliminated);
  const lifeShadow = lifeShadowClass(player.lifeStatus, player.isEliminated);

  // Détection changement de lifeStatus → flash 800ms (cf. shouldFlashOnLifeChange)
  const [flashing, setFlashing] = useState(false);
  const lastStatusRef = useRef<LifeStatus>(player.lifeStatus);
  useEffect(() => {
    const prev = lastStatusRef.current;
    const curr = player.lifeStatus;
    lastStatusRef.current = curr;
    if (!shouldFlashOnLifeChange(prev, curr)) return;
    setFlashing(true);
    const id = window.setTimeout(() => setFlashing(false), 800);
    return () => window.clearTimeout(id);
  }, [player.lifeStatus]);

  const avatarSize = size === "sm" ? 56 : 80;
  const avatarPxCls = size === "sm" ? "h-14 w-14" : "h-20 w-20";

  return (
    <motion.div
      animate={{
        scale: isCurrent && !player.isEliminated ? 1.05 : 1,
      }}
      transition={{ type: "spring", stiffness: 240, damping: 20 }}
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-colors",
        lifeBorder,
        lifeShadow,
        isCurrent &&
          !player.isEliminated &&
          "ring-2 ring-gold ring-offset-2 ring-offset-background",
        player.isEliminated && "opacity-50",
      )}
    >
      {/* Flash overlay sur perte de vie : pulse rouge sur tout le card */}
      <AnimatePresence>
        {flashing && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.85, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="pointer-events-none absolute inset-0 rounded-2xl bg-buzz"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Avatar + overlay éliminé éventuel */}
      <div className="relative">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/10",
            avatarPxCls,
          )}
        >
          {player.avatarUrl ? (
            <Image
              src={player.avatarUrl}
              alt=""
              width={avatarSize}
              height={avatarSize}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <Crown className="h-8 w-8 text-foreground/40" aria-hidden="true" />
          )}
        </div>
        {player.isEliminated && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-foreground/70">
            <Skull
              className="h-8 w-8 text-buzz drop-shadow-[0_0_4px_rgba(0,0,0,0.6)]"
              aria-hidden="true"
            />
          </div>
        )}
      </div>

      <p
        className={cn(
          "max-w-full truncate text-center font-display text-sm font-extrabold sm:text-base",
          player.isEliminated ? "line-through text-foreground/60" : "text-foreground",
        )}
      >
        {player.pseudo}
      </p>

      <LifeHearts
        status={player.lifeStatus}
        eliminated={player.isEliminated}
      />

      {/* Badge "À jouer" sur le joueur courant */}
      {isCurrent && !player.isEliminated && (
        <span className="absolute -top-2 right-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-on-color shadow">
          À jouer
        </span>
      )}
    </motion.div>
  );
}

function LifeHearts({
  status,
  eliminated,
}: {
  status: LifeStatus;
  eliminated: boolean;
}) {
  if (eliminated) {
    return (
      <p className="text-[10px] font-bold uppercase tracking-wider text-buzz">
        Éliminé
      </p>
    );
  }
  const lit1 = status === "green";
  const lit2 = status === "green" || status === "orange";
  return (
    <div className="flex items-center gap-1">
      <Heart
        className={cn(
          "h-4 w-4 transition-colors",
          lit1 ? "fill-life-green text-life-green" : "text-foreground/20",
        )}
        aria-hidden="true"
      />
      <Heart
        className={cn(
          "h-4 w-4 transition-colors",
          lit2
            ? status === "orange"
              ? "fill-life-yellow text-life-yellow"
              : "fill-life-green text-life-green"
            : "text-foreground/20",
        )}
        aria-hidden="true"
      />
      {status === "red" && (
        <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-buzz animate-pulse">
          Rouge
        </span>
      )}
    </div>
  );
}

