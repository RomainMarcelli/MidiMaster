"use client";

import { motion } from "framer-motion";
import { Bot, Clock, Loader2, Play, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Vague V (#7) — Modal cote TV affiche quand un joueur a quitte la
 * partie depuis plus de 30s (Presence leave). L'hote choisit parmi 3
 * options pour reprendre la partie (ou la garder en pause).
 *
 * Pas de fermeture par escape ni click backdrop : la decision doit etre
 * explicite (sinon on peut rester en pause indefiniment sans s'en rendre
 * compte).
 */
export function PlayerLeftModal({
  pseudo,
  busyAction,
  onContinue,
  onWait,
  onReplaceWithBot,
}: {
  pseudo: string;
  /** Si non null, l'action correspondante est en cours (loader + boutons disabled). */
  busyAction: "continue" | "wait" | "bot" | null;
  onContinue: () => void;
  onWait: () => void;
  onReplaceWithBot: () => void;
}) {
  const busy = busyAction !== null;
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-left-title"
    >
      <motion.div
        className="w-full max-w-2xl rounded-3xl bg-card p-8 shadow-2xl"
        initial={{ scale: 0.85, y: 32 }}
        animate={{ scale: 1, y: 0 }}
      >
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-buzz/15 text-buzz">
            <UserX className="h-8 w-8" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="player-left-title"
              className="font-display text-2xl font-extrabold text-foreground"
            >
              {pseudo} a quitté la partie
            </h2>
            <p className="text-sm text-foreground/60">
              Que voulez-vous faire ?
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionButton
            icon={Play}
            title="Continuer"
            description="Éliminer le joueur"
            onClick={onContinue}
            loading={busyAction === "continue"}
            disabled={busy}
          />
          <ActionButton
            icon={Clock}
            title="Attendre"
            description="Garder la partie en pause"
            onClick={onWait}
            loading={busyAction === "wait"}
            disabled={busy}
          />
          <ActionButton
            icon={Bot}
            title="Remplacer par bot"
            description="Continuer avec un bot moyen"
            onClick={onReplaceWithBot}
            loading={busyAction === "bot"}
            disabled={busy}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

function ActionButton({
  icon: Icon,
  title,
  description,
  onClick,
  loading,
  disabled,
}: {
  icon: typeof Play;
  title: string;
  description: string;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="flex h-auto flex-col items-center gap-2 p-4"
    >
      {loading ? (
        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="h-7 w-7" aria-hidden="true" />
      )}
      <span className="font-display text-base font-bold">{title}</span>
      <span className="text-[11px] font-normal opacity-70">{description}</span>
    </Button>
  );
}
