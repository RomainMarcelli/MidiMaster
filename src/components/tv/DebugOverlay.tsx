"use client";

import { useSearchParams } from "next/navigation";
import type { TvDouzeCoupsState } from "@/lib/realtime/tv-douze-coups-state";

/**
 * Vague X (#5) — Overlay de debug pour la TV en mode 12 Coups.
 *
 * Activation : query param `?debug=1` dans l'URL de la page TV
 * (ex. `/tv/host/1234?debug=1`). Sinon, le composant retourne `null` —
 * aucun rendu en prod normale.
 *
 * Affiche en bas-droite :
 *  - phase courante
 *  - currentPlayerToken et currentPlayerIdx
 *  - liste des joueurs : pseudo, lifeStatus, isEliminated, isBot, online
 *  - duelMemory si présent
 *  - currentDuel si actif
 *  - cpcFoundIndices si non-vide
 *  - pausedReason si pause active
 *
 * Mis à jour automatiquement à chaque re-render (le parent passe le state
 * à jour). Pas de fetch externe, pas de subscription.
 */
export interface DebugOverlayProps {
  state: TvDouzeCoupsState;
  /** Tokens des joueurs présents en Presence (pour annoter "offline"). */
  presenceTokens?: Set<string>;
}

export function DebugOverlay({ state, presenceTokens }: DebugOverlayProps) {
  const searchParams = useSearchParams();
  const debug = searchParams.get("debug");

  if (debug !== "1") return null;

  const currentToken = state.turnOrder[state.currentPlayerIdx] ?? null;

  return (
    <div
      className="fixed bottom-2 right-2 z-[200] max-h-[420px] w-[420px] max-w-[90vw] overflow-auto rounded-md border border-emerald-500/40 bg-black/90 p-3 font-mono text-[11px] leading-tight text-emerald-300 shadow-2xl"
      role="region"
      aria-label="Debug overlay"
    >
      <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
        Debug · 12 Coups
      </h3>

      <div className="text-emerald-200">
        <span className="text-emerald-500">phase:</span>{" "}
        <strong className="text-amber-200">{state.phase}</strong>
      </div>
      <div className="text-emerald-200">
        <span className="text-emerald-500">turn:</span> idx={state.currentPlayerIdx}{" "}
        token={currentToken ?? "—"}
      </div>

      <div className="mt-2 text-emerald-500">players:</div>
      <ul className="ml-2">
        {state.players.map((p) => {
          const online = presenceTokens
            ? presenceTokens.has(p.token) || p.isBot
            : true;
          return (
            <li key={p.token}>
              <span className="text-emerald-200">{p.pseudo}</span>
              {p.isBot ? <span className="text-amber-400"> [bot]</span> : null}
              {!online ? (
                <span className="text-rose-400"> [offline]</span>
              ) : null}
              :{" "}
              <span
                className={
                  p.lifeStatus === "green"
                    ? "text-lime-400"
                    : p.lifeStatus === "orange"
                      ? "text-amber-400"
                      : "text-rose-400"
                }
              >
                {p.lifeStatus}
              </span>
              {p.isEliminated ? (
                <span className="text-rose-400"> ELIM</span>
              ) : null}
              {p.isFinalist ? (
                <span className="text-amber-300"> FIN</span>
              ) : null}{" "}
              <span className="text-emerald-600">score={p.score}</span>
            </li>
          );
        })}
      </ul>

      {state.duelMemory ? (
        <div className="mt-2">
          <div className="text-emerald-500">duelMemory:</div>
          <ul className="ml-2">
            {state.duelMemory.proposedThemes.map((t) => (
              <li key={t.id}>
                {t.nom} (id={t.id})
                {state.duelMemory?.chosenInDuel1 === t.id ? (
                  <span className="text-amber-300"> ✓ chosen</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-2 text-emerald-700">duelMemory: null</div>
      )}

      {state.currentDuel ? (
        <div className="mt-2">
          <div className="text-emerald-500">currentDuel:</div>
          <div className="ml-2 text-emerald-200">
            challenger={state.currentDuel.challengerToken.slice(-6)}
          </div>
          <div className="ml-2 text-emerald-200">
            candidate=
            {state.currentDuel.candidateToken
              ? state.currentDuel.candidateToken.slice(-6)
              : "—"}
          </div>
          <div className="ml-2 text-emerald-200">
            chosenThemeId={state.currentDuel.chosenThemeId ?? "—"}
          </div>
        </div>
      ) : null}

      {state.cpcFoundIndices && state.cpcFoundIndices.length > 0 ? (
        <div className="mt-2 text-emerald-200">
          <span className="text-emerald-500">cpcFound:</span> [
          {state.cpcFoundIndices.join(", ")}]
        </div>
      ) : null}

      {state.pausedReason ? (
        <div className="mt-2 text-rose-300">
          PAUSED: {state.pausedReason} ·{" "}
          {state.pausedPlayerPseudo ?? "?"}
        </div>
      ) : null}

      <div className="mt-2 text-emerald-700">
        Activate via <code>?debug=1</code> in URL.
      </div>
    </div>
  );
}
