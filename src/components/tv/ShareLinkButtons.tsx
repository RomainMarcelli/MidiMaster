"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Share2 } from "lucide-react";

/**
 * Vague S4 — 2 boutons pour faciliter le partage du lien de la room :
 *  - **Copier le lien** : utilise `navigator.clipboard.writeText`. Animation
 *    "✓ Copié !" pendant 2 s.
 *  - **Partager** : utilise l'API native `navigator.share` (Web Share API)
 *    si disponible. Sinon le bouton est masqué (sur PC desktop typiquement).
 *
 * Le composant gère le `useState` du feedback "copié" en interne.
 */
export function ShareLinkButtons({
  url,
  title = "Rejoins la partie !",
  text = "Rejoins-moi sur Mahylan Quiz",
}: {
  url: string;
  title?: string;
  text?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState<boolean | null>(null);

  // Détection du support Web Share API au mount (côté client uniquement)
  if (canShare === null && typeof navigator !== "undefined") {
    setCanShare(typeof navigator.share === "function");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback : sélection manuelle si clipboard inaccessible
      // (rare : iframe sans permission par exemple)
    }
  }

  async function handleShare() {
    if (typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title, text, url });
    } catch {
      // Annulation utilisateur, ignore.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <motion.button
        type="button"
        onClick={handleCopy}
        whileTap={{ scale: 0.96 }}
        aria-label="Copier le lien dans le presse-papier"
        className="inline-flex items-center gap-2 rounded-full border-2 border-gold/50 bg-card px-4 py-2 text-sm font-bold text-gold-warm transition-all hover:border-gold hover:bg-gold/10"
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="copied"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="flex items-center gap-2"
            >
              <Check className="h-4 w-4 text-life-green" aria-hidden="true" strokeWidth={3} />
              <span className="text-life-green">Copié !</span>
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="flex items-center gap-2"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copier le lien
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {canShare && (
        <motion.button
          type="button"
          onClick={handleShare}
          whileTap={{ scale: 0.96 }}
          aria-label="Partager le lien via le menu natif"
          className="inline-flex items-center gap-2 rounded-full border-2 border-sky/50 bg-card px-4 py-2 text-sm font-bold text-sky transition-all hover:border-sky hover:bg-sky/10"
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Partager
        </motion.button>
      )}
    </div>
  );
}
