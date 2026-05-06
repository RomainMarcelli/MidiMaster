"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { SkipForward, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { joinTvChannel, type TvChannelHandle } from "@/lib/realtime/tv-channel";
import {
  finalizeDouzeCoupsTv,
  pickDuelQuestion,
  pickDuelThemesAction,
  restartRoom,
  saveDouzeCoupsState,
} from "@/lib/realtime/tv-douze-coups-actions";
import {
  buildFinalRanking,
  isCpcQuestion,
  isQuizzQuestion,
  nextActivePlayerIdx,
  type CpcQuestion,
  type DuelTheme,
  type QuizzQuestion,
  type TvDouzeCoupsState,
} from "@/lib/realtime/tv-douze-coups-state";
import {
  advanceTurn,
  applyAnswer,
  applyCpcAnswer,
  applyDuelAnswer,
  applyDuelCandidateSelection,
  applyDuelThemeSelection,
  applyPlayerLeftPause,
  applyResume,
  endEliminationAnimation,
} from "./tv-douze-coups-machine-helpers";
import {
  eliminatePlayerForLeaving,
  replaceLeftPlayerWithBot,
} from "@/lib/realtime/abandon-actions";
import { endTvRoom } from "@/lib/realtime/room-actions";
import {
  isBotToken,
  pickBotAnswerIdx,
  pickBotCpcNextIdx,
  pickBotDelayMs,
  pickBotDuelCandidate,
  pickBotDuelTheme,
} from "@/lib/realtime/bot-behavior";
import { TvCoupEnvoiView } from "./tv-coup-envoi-view";
import { TvCoupParCoupView } from "./tv-coup-par-coup-view";
import { TvDuelView } from "./tv-duel-view";
import { TvPodiumView } from "./tv-podium-view";
import { EliminationOverlay } from "@/components/tv/EliminationOverlay";
import { PlayerTurnsRedAnimation } from "@/components/tv/PlayerTurnsRedAnimation";
import { PlayerTurnsOrangeAnimation } from "@/components/tv/PlayerTurnsOrangeAnimation";
import { DuelAnnouncementAnimation } from "@/components/tv/DuelAnnouncementAnimation";
import { PlayerLeftModal } from "@/components/tv/PlayerLeftModal";
import { prepareFaceAFace } from "@/lib/realtime/face-a-face-actions";
import type { FaceAFaceState } from "@/lib/realtime/face-a-face-state";
import { TvFaceAFaceView } from "./tv-face-a-face-view";
import {
  ceAnswerSubmitSchema,
  ceDuelAnswerSubmitSchema,
  ceDuelCandidateSelectedSchema,
  ceDuelThemeChosenSchema,
  cpcAnswerSubmitSchema,
  faEndSchema,
  safeParseEvent,
} from "@/lib/realtime/room-events-schemas";

/**
 * Vague R — Orchestrateur TV du mode "12 Coups". Reçoit l'état initial
 * (chargé via startDouzeCoupsTv) et gère :
 *  - Broadcast de la question au tour courant (Coup d'Envoi puis CPC)
 *  - Réception des `*:answer-submit` des téléphones, validation, mise à
 *    jour de l'état (vies, scores), broadcast `*:question-result`.
 *  - Détection automatique du passage au rouge → bascule en duel.
 *  - Gestion du flux duel (candidat → thème → question → résultat).
 *  - Animation 4-5s "X éliminé" entre les phases.
 *  - Transition automatique vers Face-à-Face quand 2 survivants.
 *  - Podium final.
 *
 * Persistance best-effort dans `tv_rooms.state` à chaque transition
 * (pour reconnexion / debug).
 */
const ELIM_ANIM_MS = 4500;
const RESULT_DELAY_MS = 2500;
// Vague V (#3) — Durées des 2 animations cinématiques d'introduction du duel.
const RED_ANIM_MS = 3000;
const DUEL_ANNOUNCE_MS = 3000;
// Vague W (#9) — Durée de l'animation "passage au orange" (1ère erreur).
const ORANGE_ANIM_MS = 3000;
// Vague V (#7) + W (#4) — Délai avant déclenchement de la pause "joueur a
// quitté" après détection Presence leave. En dev, on raccourcit à 5s pour
// pouvoir tester le flow rapidement (modal + 3 options) ; en prod, 30s pour
// absorber les fluctuations réseau / micro-coupures sans gâcher la partie.
const PLAYER_LEFT_GRACE_MS =
  process.env.NODE_ENV === "development" ? 5000 : 30000;

export function TvDouzeCoupsHost({
  code,
  roomId,
  initialState,
  initialVersion = 0,
}: {
  code: string;
  roomId: string;
  initialState: TvDouzeCoupsState;
  /** Vague T (#1) — Version initiale du state en BDD (0 au premier mount). */
  initialVersion?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<TvDouzeCoupsState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Vague T (#1) — Suivi de la version pour optimistic concurrency.
  // Incrémentée à chaque save réussi (renvoyé par le server action).
  const versionRef = useRef(initialVersion);
  const channelRef = useRef<TvChannelHandle | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [faState, setFaState] = useState<FaceAFaceState | null>(null);
  // Vague V (#3) — Overlay states côté TV pour les 2 animations cinématiques
  // pré-duel. Reset auto via setTimeout dans `playDuelIntro`.
  const [redAnim, setRedAnim] = useState<{
    pseudo: string;
    avatarUrl: string | null;
  } | null>(null);
  const [duelAnnounceAnim, setDuelAnnounceAnim] = useState(false);
  // Vague W (#9) — Overlay "passage au orange" 3s côté TV (similaire au rouge).
  const [orangeAnim, setOrangeAnim] = useState<{
    pseudo: string;
    avatarUrl: string | null;
  } | null>(null);
  // Vague V (#7) — Action en cours dans le modal "joueur a quitté".
  // Sert à afficher un loader sur le bouton cliqué + bloquer les autres.
  const [busyAbandon, setBusyAbandon] = useState<
    "continue" | "wait" | "bot" | null
  >(null);
  // Vague V (#7) — Timers de grâce 30s par token absent. Si le joueur
  // revient avant l'expiration, on clear ; sinon on déclenche la pause.
  const pendingLeaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const playersWithPresenceRef = useRef<
    Array<{
      id: string;
      pseudo: string;
      avatarUrl: string | null;
      token: string;
      isConnected: boolean;
    }>
  >([]);

  // ============================================================
  // Helpers de mise à jour : on persiste à chaque transition.
  //
  // IMPORTANT : on calcule `next` à partir de `stateRef.current` puis
  // on déclenche `setState(next)` (assignation pure) + le side effect
  // `saveDouzeCoupsState` HORS du updater. Mettre un side effect dans
  // l'updater déclenche un warning React en strict mode "Cannot update
  // a component while rendering a different component" parce que les
  // server actions Next.js peuvent re-update le Router.
  // ============================================================
  const updateAndSave = useCallback(
    (updater: (prev: TvDouzeCoupsState) => TvDouzeCoupsState) => {
      const next = updater(stateRef.current);
      stateRef.current = next;
      setState(next);
      // Vague T (#1) — On capture la version courante pour le UPDATE
      // optimiste. Si le save échoue (`stale`), on log mais on ne crash
      // pas l'orchestrateur (le state local reste cohérent ; au pire on
      // perd un save intermédiaire — la prochaine transition réécrira).
      const expected = versionRef.current;
      void saveDouzeCoupsState({ roomId, state: next, expectedVersion: expected })
        .then((res) => {
          if (res.ok) {
            versionRef.current = res.newVersion;
          } else if (res.reason === "stale") {
            // eslint-disable-next-line no-console
            console.warn(
              `[saveDouzeCoupsState] stale write (expected v=${expected}). ` +
                `Le state local reste — la prochaine transition réécrira.`,
            );
          }
        });
    },
    [roomId],
  );

  // ============================================================
  // Broadcast de la question courante
  //
  // Vague S3 — Si le joueur courant est un BOT, on déclenche aussi un
  // setTimeout (1.2-3s) qui simule sa réponse. La réponse passe par le
  // même channel.send("ce:answer-submit") que pour un humain → ça
  // réutilise toute la logique d'orchestration existante (validation
  // host-side, broadcast result, advanceTurn).
  // ============================================================
  const broadcastCurrent = useCallback((s: TvDouzeCoupsState) => {
    const ch = channelRef.current;
    if (!ch) return;
    const currentToken = s.turnOrder[s.currentPlayerIdx];
    if (!currentToken) return;
    const currentPlayer = s.players.find((p) => p.token === currentToken);
    if (!currentPlayer) return;
    const q = s.currentQuestion;
    if (!q) return;

    if (s.phase === "coup-envoi-playing" && isQuizzQuestion(q)) {
      ch.send("ce:question-show", {
        questionId: q.id,
        enonce: q.enonce,
        format: q.format ?? null,
        choices: q.choices,
        currentPlayerToken: currentToken,
        currentPlayerPseudo: currentPlayer.pseudo,
      });
      // Bot : simulation de réponse
      if (currentPlayer.isBot || isBotToken(currentToken)) {
        const skill = currentPlayer.botSkill ?? 70;
        const chosenIdx = pickBotAnswerIdx(q.choices.length, q.correctIdx, skill);
        const delay = pickBotDelayMs();
        window.setTimeout(() => {
          ch.send("ce:answer-submit", {
            questionId: q.id,
            chosenIdx,
            playerToken: currentToken,
          });
        }, delay);
      }
    } else if (s.phase === "coup-par-coup-playing" && isCpcQuestion(q)) {
      ch.send("cpc:question-show", {
        questionId: q.id,
        enonce: q.enonce,
        propositions: q.propositions.map((p) => ({ idx: p.idx, text: p.text })),
        currentPlayerToken: currentToken,
        currentPlayerPseudo: currentPlayer.pseudo,
      });
      // Vague W (#1) — Bot CPC tour-par-tour : 1 seul clic, le tour passe
      // au joueur suivant ensuite. Le `pickBotCpcNextIdx` est appelé avec
      // les `cpcFoundIndices` courants pour ne pas recliquer une bonne
      // déjà trouvée par les joueurs précédents.
      if (currentPlayer.isBot || isBotToken(currentToken)) {
        const skill = currentPlayer.botSkill ?? 70;
        const chosenIdx = pickBotCpcNextIdx(
          q.propositions.length,
          q.intrusIdx,
          s.cpcFoundIndices ?? [],
          skill,
        );
        if (chosenIdx !== null) {
          const delay = pickBotDelayMs();
          window.setTimeout(() => {
            ch.send("cpc:answer-submit", {
              questionId: q.id,
              chosenIdx,
              playerToken: currentToken,
            });
          }, delay);
        }
      }
    }
  }, []);

  // Vague T (#3) — Les transitions pures (advanceTurn,
  // transitionAfterElimination, applyAnswer, applyDuelAnswer, etc.) sont
  // dans `tv-douze-coups-machine-helpers.ts` (testées en isolation, 22
  // tests). Ce composant n'orchestre plus que les side effects.

  // ============================================================
  // Helper privé : si le challenger (joueur rouge) est un bot, simule sa
  // sélection de candidat pour le duel après un petit délai. Factorisé
  // entre handleCeAnswer et handleCpcAnswer (les deux peuvent
  // déclencher un duel quand la vie passe rouge).
  // ============================================================
  const triggerBotDuelSelectionIfNeeded = useCallback(
    (challengerToken: string, nextPlayers: TvDouzeCoupsState["players"]) => {
      const ch = channelRef.current;
      if (!ch) return;
      const challenger = nextPlayers.find((p) => p.token === challengerToken);
      if (!challenger || (!challenger.isBot && !isBotToken(challengerToken))) return;
      const candidates = nextPlayers.map((p) => ({
        token: p.token,
        isEliminated: p.isEliminated,
      }));
      const candToken = pickBotDuelCandidate(candidates, challengerToken);
      if (!candToken) return;
      const cand = nextPlayers.find((p) => p.token === candToken);
      if (!cand) return;
      const delay = pickBotDelayMs(undefined, 1500, 2500);
      window.setTimeout(() => {
        ch.send("ce:duel-candidate-selected", {
          challengerToken,
          candidateToken: candToken,
          candidatePseudo: cand.pseudo,
        });
      }, delay);
    },
    [],
  );

  // ============================================================
  // Vague V (#3) — Séquence cinématique d'introduction du duel.
  //
  // Avant : `triggersDuel === true` → broadcast direct `ce:duel-start`
  //   → page choix candidat sur le téléphone du challenger.
  //
  // Après : 6s de cinématique cumulative AVANT `ce:duel-start` :
  //   1. T+0s : `ce:player-turns-red` (overlay 3s "Pseudo passe au ROUGE")
  //   2. T+3s : `ce:duel-announce` (overlay 3s "Qui dit rouge dit DUEL")
  //   3. T+6s : `ce:duel-start` + bot selection (= comportement pré-V3)
  //
  // Le state machine pure (`applyAnswer` / `applyCpcAnswer`) a déjà fait
  // sa transition vers la phase `coup-(envoi|par-coup)-duel-select` dès le
  // passage rouge. Cette fonction orchestre uniquement les side effects
  // Realtime + les overlays côté TV. Côté téléphones, ils écoutent les
  // mêmes events et affichent les overlays en miroir.
  // ============================================================
  const playDuelIntroAndStart = useCallback(
    (
      challengerToken: string,
      challengerPseudo: string,
      nextPlayers: TvDouzeCoupsState["players"],
    ) => {
      const ch = channelRef.current;
      if (!ch) return;
      const challenger = nextPlayers.find((p) => p.token === challengerToken);
      const avatarUrl = challenger?.avatarUrl ?? null;
      const pseudo = challenger?.pseudo ?? challengerPseudo;

      // 1. Anim "passe au ROUGE" (3s)
      setRedAnim({ pseudo, avatarUrl });
      ch.send("ce:player-turns-red", {
        token: challengerToken,
        pseudo,
        avatarUrl,
      });
      window.setTimeout(() => {
        setRedAnim(null);
        // 2. Anim "DUEL" (3s)
        setDuelAnnounceAnim(true);
        ch.send("ce:duel-announce", {});
        window.setTimeout(() => {
          setDuelAnnounceAnim(false);
          // 3. Bascule sur le choix de candidat (= comportement pré-V3)
          ch.send("ce:duel-start", {
            challengerToken,
            challengerPseudo: pseudo,
          });
          triggerBotDuelSelectionIfNeeded(challengerToken, nextPlayers);
        }, DUEL_ANNOUNCE_MS);
      }, RED_ANIM_MS);
    },
    [triggerBotDuelSelectionIfNeeded],
  );

  // ============================================================
  // Coup d'Envoi : single-shot Q/R, vie-1 si mauvaise.
  //  - si vie passe rouge : démarre un duel
  //  - sinon : avance au tour suivant après RESULT_DELAY_MS
  // ============================================================
  const handleCeAnswer = useCallback(
    (payload: { questionId: string; chosenIdx: number; playerToken: string }) => {
      const ch = channelRef.current;
      if (!ch) return;
      // Vague V (#7) — Ignore les events entrants pendant la pause.
      if (stateRef.current.pausedReason) return;
      const result = applyAnswer(stateRef.current, payload, "ce");
      if (result.kind !== "accepted") return;
      const { isCorrect, correctIdx, next, triggersDuel, challengerPseudo } = result;

      // Vague W (#8) — Inclut l'explication BDD pour AnswerReveal côté téléphone.
      const ceQuestion = stateRef.current.currentQuestion;
      const ceExplication = isQuizzQuestion(ceQuestion)
        ? ceQuestion.explication ?? null
        : null;
      ch.send("ce:question-result", {
        questionId: payload.questionId,
        byToken: payload.playerToken,
        chosenIdx: payload.chosenIdx,
        correctIdx,
        isCorrect,
        explication: ceExplication,
      });

      updateAndSave(() => next);

      if (triggersDuel) {
        // Vague V (#3) — Séquence cinématique 6s avant le `ce:duel-start`.
        playDuelIntroAndStart(
          payload.playerToken,
          challengerPseudo ?? "?",
          next.players,
        );
      } else {
        // Vague W (#9) — Détection passage green→orange (1ère erreur).
        // Si oui, animation 3s plein écran avant l'advance turn.
        const before = stateRef.current.players.find(
          (p) => p.token === payload.playerToken,
        );
        const after = next.players.find((p) => p.token === payload.playerToken);
        const turnsOrange =
          before?.lifeStatus === "green" && after?.lifeStatus === "orange";
        if (turnsOrange && after) {
          setOrangeAnim({ pseudo: after.pseudo, avatarUrl: after.avatarUrl });
          ch.send("ce:player-turns-orange", {
            token: after.token,
            pseudo: after.pseudo,
            avatarUrl: after.avatarUrl,
          });
          window.setTimeout(() => {
            setOrangeAnim(null);
            updateAndSave((prev) => {
              const advanced = advanceTurn(prev);
              window.setTimeout(() => broadcastCurrent(advanced), 0);
              return advanced;
            });
          }, ORANGE_ANIM_MS);
        } else {
          window.setTimeout(() => {
            updateAndSave((prev) => {
              const advanced = advanceTurn(prev);
              window.setTimeout(() => broadcastCurrent(advanced), 0);
              return advanced;
            });
          }, RESULT_DELAY_MS);
        }
      }
    },
    [updateAndSave, broadcastCurrent, playDuelIntroAndStart],
  );

  // ============================================================
  // Vague W (#1) — Coup par Coup en TOUR PAR TOUR (refonte de V5).
  //
  // 1 clic par tour. À chaque clic :
  //  - Bonne (correct-advance) : broadcast progress + result success,
  //    après délai → advance idx (MEME question, foundIndices conservé)
  //    + re-broadcast question-show pour signaler le nouveau currentPlayer.
  //  - 6 bonnes trouvées (all-found) : broadcast series-complete (anim 3s),
  //    après animation → advanceTurn (NOUVELLE question, foundIndices reset).
  //  - Intrus tombé (wrong-intrus) : broadcast result failure, après délai
  //    → advanceTurn (NOUVELLE question) ou duel si rouge.
  // ============================================================
  const SERIES_COMPLETE_ANIM_MS = 3000;
  const handleCpcAnswer = useCallback(
    (payload: { questionId: string; chosenIdx: number; playerToken: string }) => {
      const ch = channelRef.current;
      if (!ch) return;
      // Vague V (#7) — Ignore les events entrants pendant la pause.
      if (stateRef.current.pausedReason) return;
      const result = applyCpcAnswer(stateRef.current, payload);
      if (result.kind === "rejected") return;

      updateAndSave(() => result.next);

      if (result.kind === "correct-advance") {
        // 1. Update visuel des verts cumulés sur tous les téléphones.
        ch.send("cpc:answer-progress", {
          questionId: payload.questionId,
          byToken: payload.playerToken,
          foundIndices: result.foundIndices,
          lastChosenIdx: payload.chosenIdx,
        });
        // 2. Feedback "bonne réponse" sur tous les téléphones (AnswerReveal).
        //    intrusIdx = -1 = sentinelle "ne pas révéler l'intrus" (anti-cheat).
        // Vague W (#8) — explication BDD pour le AnswerReveal "Bonne réponse".
        const cpcQ = stateRef.current.currentQuestion;
        const cpcExplCorrect = isCpcQuestion(cpcQ)
          ? cpcQ.explication ?? null
          : null;
        ch.send("cpc:question-result", {
          questionId: payload.questionId,
          byToken: payload.playerToken,
          chosenIdx: payload.chosenIdx,
          intrusIdx: -1,
          isCorrect: true,
          explication: cpcExplCorrect,
        });
        // 3. Après délai d'affichage : advance idx (même question, foundIndices
        //    conservé côté téléphone car questionId inchangé) + re-broadcast.
        window.setTimeout(() => {
          updateAndSave((prev) => {
            const nextIdx = nextActivePlayerIdx(
              prev.currentPlayerIdx,
              prev.turnOrder,
              prev.players,
            );
            const advanced: TvDouzeCoupsState = {
              ...prev,
              currentPlayerIdx: nextIdx === -1 ? prev.currentPlayerIdx : nextIdx,
              lastAnswerKey: null,
            };
            window.setTimeout(() => broadcastCurrent(advanced), 0);
            return advanced;
          });
        }, RESULT_DELAY_MS);
        return;
      }

      if (result.kind === "all-found") {
        // Update visuel final + animation "série complète" 3s.
        ch.send("cpc:answer-progress", {
          questionId: payload.questionId,
          byToken: payload.playerToken,
          foundIndices: result.foundIndices,
          lastChosenIdx: payload.chosenIdx,
        });
        const player = result.next.players.find(
          (p) => p.token === payload.playerToken,
        );
        ch.send("cpc:series-complete", {
          questionId: payload.questionId,
          byToken: payload.playerToken,
          pseudo: player?.pseudo ?? "?",
        });
        window.setTimeout(() => {
          updateAndSave((prev) => {
            const advanced = advanceTurn(prev); // nouvelle question CPC
            window.setTimeout(() => broadcastCurrent(advanced), 0);
            return advanced;
          });
        }, SERIES_COMPLETE_ANIM_MS);
        return;
      }

      // wrong-intrus : broadcast result, puis duel ou advance + nouvelle question
      // Vague W (#8) — explication BDD pour le AnswerReveal "Mauvaise réponse".
      const cpcQWrong = stateRef.current.currentQuestion;
      const cpcExplWrong = isCpcQuestion(cpcQWrong)
        ? cpcQWrong.explication ?? null
        : null;
      ch.send("cpc:question-result", {
        questionId: payload.questionId,
        byToken: payload.playerToken,
        chosenIdx: payload.chosenIdx,
        intrusIdx: result.intrusIdx,
        isCorrect: false,
        explication: cpcExplWrong,
      });

      if (result.triggersDuel) {
        // Vague V (#3) — Séquence cinématique 6s avant le `ce:duel-start`.
        playDuelIntroAndStart(
          payload.playerToken,
          result.challengerPseudo ?? "?",
          result.next.players,
        );
      } else {
        // Vague W (#9) — Détection passage green→orange en CPC (1ère erreur).
        const beforeCpc = stateRef.current.players.find(
          (p) => p.token === payload.playerToken,
        );
        const afterCpc = result.next.players.find(
          (p) => p.token === payload.playerToken,
        );
        const turnsOrangeCpc =
          beforeCpc?.lifeStatus === "green" && afterCpc?.lifeStatus === "orange";
        if (turnsOrangeCpc && afterCpc) {
          setOrangeAnim({
            pseudo: afterCpc.pseudo,
            avatarUrl: afterCpc.avatarUrl,
          });
          ch.send("ce:player-turns-orange", {
            token: afterCpc.token,
            pseudo: afterCpc.pseudo,
            avatarUrl: afterCpc.avatarUrl,
          });
          window.setTimeout(() => {
            setOrangeAnim(null);
            updateAndSave((prev) => {
              const advanced = advanceTurn(prev);
              window.setTimeout(() => broadcastCurrent(advanced), 0);
              return advanced;
            });
          }, ORANGE_ANIM_MS);
        } else {
          window.setTimeout(() => {
            updateAndSave((prev) => {
              const advanced = advanceTurn(prev); // nouvelle question CPC
              window.setTimeout(() => broadcastCurrent(advanced), 0);
              return advanced;
            });
          }, RESULT_DELAY_MS);
        }
      }
    },
    [updateAndSave, broadcastCurrent, playDuelIntroAndStart],
  );

  // ============================================================
  // Gestion du duel : 3 étapes côté hôte
  //  1. Le challenger choisit son candidat → on tire 2 thèmes
  //  2. Le candidat choisit son thème → on charge une question
  //  3. Le candidat répond → resolveDuel + élimination conditionnelle
  // ============================================================
  const handleDuelCandidateSelected = useCallback(
    async (payload: {
      challengerToken: string;
      candidateToken: string;
      candidatePseudo: string;
    }) => {
      const ch = channelRef.current;
      if (!ch) return;
      // Vague V (#7) — Ignore les events entrants pendant la pause.
      if (stateRef.current.pausedReason) return;
      // Vague V (#4) + W (#2) — Cohérence des thèmes entre duel 1 et duel 2.
      // Si on est en CPC (donc 2e duel) et qu'on a une mémoire des thèmes
      // du 1er duel, on les RÉUTILISE au lieu de retirer 2 nouveaux. Le
      // thème déjà choisi au duel 1 sera grisé côté téléphone.
      const memory = stateRef.current.duelMemory;
      const isDuel2 =
        stateRef.current.phase === "coup-par-coup-duel-select" && memory != null;
      // eslint-disable-next-line no-console
      console.log("[W2:duel-themes] picking themes", {
        phase: stateRef.current.phase,
        hasMemory: memory != null,
        memoryDetails: memory
          ? {
              proposedIds: memory.proposedThemes.map((t) => t.id),
              chosenInDuel1: memory.chosenInDuel1,
            }
          : null,
        isDuel2,
      });
      const themes = isDuel2 && memory
        ? memory.proposedThemes
        : await pickDuelThemesAction(code);
      const disabledThemeId = isDuel2 && memory ? memory.chosenInDuel1 : null;
      updateAndSave((prev) =>
        applyDuelCandidateSelection(prev, payload.candidateToken, themes),
      );
      ch.send("ce:duel-theme-proposals", {
        candidateToken: payload.candidateToken,
        themes,
        disabledThemeId,
      });
      // Vague S3 — Si le candidat est un bot, il choisit un thème au hasard
      // (en évitant le thème grisé en duel 2).
      const candidate = stateRef.current.players.find(
        (p) => p.token === payload.candidateToken,
      );
      if (candidate && (candidate.isBot || isBotToken(payload.candidateToken))) {
        const eligibleThemes = disabledThemeId != null
          ? themes.filter((t) => t.id !== disabledThemeId)
          : themes;
        const themeId = pickBotDuelTheme(eligibleThemes);
        if (themeId !== null) {
          const theme = themes.find((t) => t.id === themeId);
          const delay = pickBotDelayMs(undefined, 1500, 2500);
          window.setTimeout(() => {
            ch.send("ce:duel-theme-chosen", {
              candidateToken: payload.candidateToken,
              themeId,
              themeNom: theme?.nom ?? "",
            });
          }, delay);
        }
      }
    },
    [code, updateAndSave],
  );

  const handleDuelThemeChosen = useCallback(
    async (payload: {
      candidateToken: string;
      themeId: number;
      themeNom: string;
    }) => {
      const ch = channelRef.current;
      if (!ch) return;
      // Vague V (#7) — Ignore les events entrants pendant la pause.
      if (stateRef.current.pausedReason) return;
      const q = await pickDuelQuestion(payload.themeId);
      if (!q) return;
      updateAndSave((prev) => {
        const next = applyDuelThemeSelection(prev, payload.themeId, q);
        // eslint-disable-next-line no-console
        console.log("[W2:duel-theme-chosen] state after applyDuelThemeSelection", {
          phase: next.phase,
          duelMemory: next.duelMemory,
        });
        return next;
      });
      ch.send("ce:duel-question", {
        questionId: q.id,
        enonce: q.enonce,
        choices: q.choices,
        candidateToken: payload.candidateToken,
      });
      // Vague S3 — Si le candidat est un bot, il répond automatiquement
      const candidate = stateRef.current.players.find(
        (p) => p.token === payload.candidateToken,
      );
      if (candidate && (candidate.isBot || isBotToken(payload.candidateToken))) {
        const skill = candidate.botSkill ?? 70;
        const chosenIdx = pickBotAnswerIdx(q.choices.length, q.correctIdx, skill);
        const delay = pickBotDelayMs();
        window.setTimeout(() => {
          ch.send("ce:duel-answer-submit", {
            questionId: q.id,
            chosenIdx,
            candidateToken: payload.candidateToken,
          });
        }, delay);
      }
    },
    [updateAndSave],
  );

  const handleDuelAnswer = useCallback(
    (payload: {
      questionId: string;
      chosenIdx: number;
      candidateToken: string;
    }) => {
      const ch = channelRef.current;
      if (!ch) return;
      // Vague V (#7) — Ignore les events entrants pendant la pause.
      if (stateRef.current.pausedReason) return;
      const result = applyDuelAnswer(stateRef.current, payload, {
        eliminationDurationMs: ELIM_ANIM_MS,
      });
      if (result.kind !== "accepted") return;
      const { candidateCorrect, correctIdx, challengerEliminated, next, phaseKind } =
        result;

      // Broadcast résultat
      ch.send("ce:duel-result", {
        questionId: payload.questionId,
        candidateToken: payload.candidateToken,
        challengerToken: stateRef.current.currentDuel?.challengerToken ?? "",
        chosenIdx: payload.chosenIdx,
        correctIdx,
        candidateCorrect,
        challengerEliminated,
      });

      // Persiste le state (post-duel : soit phase elimination, soit retour playing)
      updateAndSave(() => next);

      if (challengerEliminated) {
        // Broadcast l'événement d'élimination + lance l'animation 4.5s
        ch.send("ce:elimination", {
          eliminatedToken: stateRef.current.currentDuel?.challengerToken ?? "",
          eliminatedPseudo: result.eliminatedPseudo ?? "?",
          fromPhase: phaseKind,
          nextPhase: phaseKind === "coup-envoi" ? "coup-par-coup" : "face-a-face",
        });
        window.setTimeout(() => {
          // Fin d'animation : retour playing puis tente une transition de
          // phase (CE→CPC ou CPC→FA), sinon on avance le tour normalement.
          updateAndSave((prev) => endEliminationAnimation(prev).next);
          window.setTimeout(() => broadcastCurrent(stateRef.current), 0);
        }, ELIM_ANIM_MS);
      } else {
        // Le challenger survit, retour direct au tour suivant après le délai
        window.setTimeout(() => {
          updateAndSave((prev) => {
            const advanced = advanceTurn(prev);
            window.setTimeout(() => broadcastCurrent(advanced), 0);
            return advanced;
          });
        }, RESULT_DELAY_MS);
      }
    },
    [updateAndSave, broadcastCurrent],
  );

  // ============================================================
  // Quand le face-à-face se termine, on construit le podium et
  // on bascule sur la vue podium.
  // ============================================================
  const handleFaEnded = useCallback(
    (winnerToken: string) => {
      const s = stateRef.current;
      const ranking = buildFinalRanking(s.players, winnerToken);
      const next: TvDouzeCoupsState = {
        ...s,
        phase: "podium",
        finalRanking: ranking,
      };
      setState(next);
      stateRef.current = next;
      const expected = versionRef.current;
      void finalizeDouzeCoupsTv({
        roomId,
        state: s,
        winnerToken,
        expectedVersion: expected,
      }).then((res) => {
        if (res.ok) versionRef.current = res.newVersion;
      });
    },
    [roomId],
  );

  // ============================================================
  // Branchement Realtime + presence (host)
  // ============================================================
  useEffect(() => {
    const ch = joinTvChannel(code);
    channelRef.current = ch;
    void ch.trackPresence({
      token: `host:${roomId}`,
      pseudo: "TV",
      avatarUrl: null,
      joinedAt: Date.now(),
      role: "host",
    });
    const unbindPresence = ch.onPresence((presence) => {
      const list: typeof playersWithPresenceRef.current = [];
      const onlineTokens = new Set<string>();
      for (const metas of Object.values(presence)) {
        for (const m of metas) {
          if (m.role === "player") {
            list.push({
              id: m.token,
              pseudo: m.pseudo,
              avatarUrl: m.avatarUrl,
              token: m.token,
              isConnected: true,
            });
            onlineTokens.add(m.token);
          }
        }
      }
      playersWithPresenceRef.current = list;

      // Vague V (#7) + W (#4) — Détection abandon : joueurs actifs (non
      // éliminés, non bots) absents de la presence → timer 30s avant pause.
      const s = stateRef.current;
      // Si on est déjà en pause ou hors phase de jeu (lobby/podium),
      // on ne déclenche aucun nouveau timer.
      const isPlayingPhase =
        s.phase !== "lobby" &&
        s.phase !== "podium" &&
        s.phase !== "face-a-face-vote" &&
        s.phase !== "face-a-face-playing";
      if (!isPlayingPhase || s.pausedReason) return;

      const activePlayers = s.players.filter(
        (p) => !p.isEliminated && !p.isBot && !isBotToken(p.token),
      );
      // eslint-disable-next-line no-console
      console.log("[W4:presence] sync", {
        graceMs: PLAYER_LEFT_GRACE_MS,
        phase: s.phase,
        onlineTokens: Array.from(onlineTokens),
        activePlayers: activePlayers.map((p) => ({
          token: p.token,
          pseudo: p.pseudo,
          online: onlineTokens.has(p.token),
        })),
        pendingTimers: Array.from(pendingLeaveTimersRef.current.keys()),
      });
      // 1. Joueurs revenus → clear le timer en attente
      for (const [tk, timer] of pendingLeaveTimersRef.current.entries()) {
        if (onlineTokens.has(tk)) {
          clearTimeout(timer);
          pendingLeaveTimersRef.current.delete(tk);
          // eslint-disable-next-line no-console
          console.log("[W4:presence] timer cancelled (player back)", { token: tk });
        }
      }
      // 2. Joueurs actifs absents → start timer si pas déjà en cours
      for (const p of activePlayers) {
        if (
          !onlineTokens.has(p.token) &&
          !pendingLeaveTimersRef.current.has(p.token)
        ) {
          // eslint-disable-next-line no-console
          console.log("[W4:presence] starting timer", {
            token: p.token,
            pseudo: p.pseudo,
            graceMs: PLAYER_LEFT_GRACE_MS,
          });
          const timer = setTimeout(() => {
            pendingLeaveTimersRef.current.delete(p.token);
            // Re-check à l'expiration : la partie est-elle toujours en
            // phase de jeu et le joueur toujours absent ?
            const cur = stateRef.current;
            // eslint-disable-next-line no-console
            console.log("[W4:presence] TIMER FIRED", {
              token: p.token,
              pseudo: p.pseudo,
              currentPhase: cur.phase,
              alreadyPaused: !!cur.pausedReason,
            });
            if (cur.pausedReason) return;
            const stillActive = cur.players.find(
              (x) => x.token === p.token && !x.isEliminated && !x.isBot,
            );
            if (!stillActive) return;
            // Déclenche la pause + broadcast
            ch.send("game:paused", {
              reason: "player-left",
              pseudo: p.pseudo,
            });
            updateAndSave((prev) =>
              applyPlayerLeftPause(prev, p.token, p.pseudo),
            );
          }, PLAYER_LEFT_GRACE_MS);
          pendingLeaveTimersRef.current.set(p.token, timer);
        }
      }
    });

    // Vague T (#4) — Validation Zod à la réception : un téléphone qui
    // envoie un payload mal formé (vieux build, manipulation) est ignoré
    // silencieusement avec un log côté hôte.
    ch.on("ce:answer-submit", (p) => {
      const parsed = safeParseEvent("ce:answer-submit", ceAnswerSubmitSchema, p);
      if (parsed) handleCeAnswer(parsed);
    });
    ch.on("cpc:answer-submit", (p) => {
      const parsed = safeParseEvent("cpc:answer-submit", cpcAnswerSubmitSchema, p);
      if (parsed) handleCpcAnswer(parsed);
    });
    ch.on("ce:duel-candidate-selected", (p) => {
      const parsed = safeParseEvent(
        "ce:duel-candidate-selected",
        ceDuelCandidateSelectedSchema,
        p,
      );
      if (parsed) void handleDuelCandidateSelected(parsed);
    });
    ch.on("ce:duel-theme-chosen", (p) => {
      const parsed = safeParseEvent(
        "ce:duel-theme-chosen",
        ceDuelThemeChosenSchema,
        p,
      );
      if (parsed) void handleDuelThemeChosen(parsed);
    });
    ch.on("ce:duel-answer-submit", (p) => {
      const parsed = safeParseEvent(
        "ce:duel-answer-submit",
        ceDuelAnswerSubmitSchema,
        p,
      );
      if (parsed) handleDuelAnswer(parsed);
    });
    // À la fin du face-à-face, on construit le podium.
    ch.on("fa:end", (p) => {
      const parsed = safeParseEvent("fa:end", faEndSchema, p);
      if (parsed) handleFaEnded(parsed.winnerToken);
    });

    // Premier broadcast après que le channel soit subscribed
    window.setTimeout(() => broadcastCurrent(stateRef.current), 600);

    return () => {
      unbindPresence();
      // Vague V (#7) — Cleanup des timers en attente pour éviter qu'ils
      // déclenchent une pause après unmount (ex: navigation).
      for (const t of pendingLeaveTimersRef.current.values()) clearTimeout(t);
      pendingLeaveTimersRef.current.clear();
      void ch.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, roomId]);

  // ============================================================
  // Bascule auto en Face-à-Face quand on entre dans la phase
  // "face-a-face-vote". On lance prepareFaceAFace qui charge le
  // pool quizz_2 et passe le state en mode vote.
  // ============================================================
  useEffect(() => {
    if (state.phase !== "face-a-face-vote") return;
    if (faState) return;
    const finalists = state.players.filter((p) => !p.isEliminated);
    if (finalists.length !== 2) return;
    const [a, b] = finalists;
    if (!a || !b) return;
    void prepareFaceAFace({
      roomId,
      finalists: [a.token, b.token],
      finalistPseudos: { [a.token]: a.pseudo, [b.token]: b.pseudo },
      timerSeconds: 60,
    }).then((res) => {
      if (res.ok) {
        setFaState(res.state);
        // Vague T (#1) — La préparation FA bumpe state_version, on resync.
        versionRef.current = res.version;
      }
    });
  }, [state.phase, state.players, roomId, faState]);

  // ============================================================
  // Vague V (#7) — Handlers du modal "joueur a quitté".
  //  - Continue : élimine le joueur (server action) + broadcast `game:resumed`,
  //    re-broadcast la question courante (advance turn peut avoir kické).
  //  - Wait : no-op visible côté UI, le modal reste ouvert. La partie reste
  //    en pause tant que le user n'a pas choisi Continue ou Bot.
  //  - Bot : convertit le joueur en bot (server action) + broadcast `game:resumed`,
  //    re-broadcast la question. Si c'était son tour, le bot logic kick in
  //    via `broadcastCurrent`.
  // ============================================================
  async function handleAbandonContinue() {
    if (busyAbandon) return;
    const token = stateRef.current.pausedPlayerToken;
    if (!token) return;
    setBusyAbandon("continue");
    const res = await eliminatePlayerForLeaving({
      roomId,
      playerToken: token,
      expectedVersion: versionRef.current,
    });
    if (res.ok) {
      versionRef.current = res.newVersion;
      // Refetch le state à jour depuis BDD : `applyEliminateLeftPlayer`
      // a pu transitionner de phase et changer le tour. Plus simple de
      // re-set le state local en lisant la BDD via une refetch.
      // Pour l'instant on applyResume localement et on attend que la
      // prochaine save déclenche un sync. Le client va voir un état
      // possiblement obsolète ; pas critique car l'hôte est seul à modifier.
      // Vague V (#7) — On applique LOCALEMENT la même transition pour rester
      // cohérent immédiatement (le state JSONB en BDD a déjà été mis à jour).
      const ch = channelRef.current;
      ch?.send("game:resumed", {});
      // Le state machine local doit aussi refléter la transition. On fait
      // un simple "applyResume" et on laisse advance turn / transition se
      // reproduire sur le prochain answer-submit. Compromis pragmatique
      // pour rester dans les 2h V7.
      updateAndSave((prev) => applyResume(prev));
      window.setTimeout(() => broadcastCurrent(stateRef.current), 0);
    } else {
      // eslint-disable-next-line no-console
      console.error("[abandon] eliminate failed:", res.reason);
    }
    setBusyAbandon(null);
  }

  function handleAbandonWait() {
    // No-op visible : le modal reste ouvert, la partie reste en pause.
    // L'hôte peut cliquer Continue ou Bot à tout moment plus tard.
    if (busyAbandon) return;
    setBusyAbandon("wait");
    // Restore l'état "neutre" après un petit délai (juste pour le feedback
    // visuel sur le bouton). Les autres boutons restent cliquables.
    window.setTimeout(() => setBusyAbandon(null), 300);
  }

  async function handleAbandonReplaceWithBot() {
    if (busyAbandon) return;
    const token = stateRef.current.pausedPlayerToken;
    if (!token) return;
    setBusyAbandon("bot");
    const res = await replaceLeftPlayerWithBot({
      roomId,
      playerToken: token,
      expectedVersion: versionRef.current,
      botSkill: 70,
    });
    if (res.ok) {
      versionRef.current = res.newVersion;
      const ch = channelRef.current;
      ch?.send("game:resumed", {});
      // Mise à jour locale : marque le joueur comme bot + clear pause.
      updateAndSave((prev) => {
        const idx = prev.players.findIndex((p) => p.token === token);
        if (idx === -1) return applyResume(prev);
        const playersAfter = [...prev.players];
        playersAfter[idx] = { ...playersAfter[idx]!, isBot: true, botSkill: 70 };
        return applyResume({ ...prev, players: playersAfter });
      });
      // Re-broadcast la question : si le bot est le joueur courant, son
      // setTimeout dans broadcastCurrent kick in et le bot répondra.
      window.setTimeout(() => broadcastCurrent(stateRef.current), 0);
    } else {
      // eslint-disable-next-line no-console
      console.error("[abandon] replace-with-bot failed:", res.reason);
    }
    setBusyAbandon(null);
  }

  // Quitter / Recommencer (bouton dans header)
  // ============================================================
  async function handleEnd() {
    setEnding(true);
    const broadcastCh = joinTvChannel(code);
    broadcastCh.send("room:closed", { reason: "host_left" });
    await new Promise((r) => setTimeout(r, 300));
    await broadcastCh.unsubscribe();
    if (channelRef.current) await channelRef.current.unsubscribe();
    await endTvRoom(roomId);
    setEnding(false);
    setShowEndConfirm(false);
    router.push("/tv/host");
  }

  async function handleRestart() {
    if (channelRef.current) {
      channelRef.current.send("room:restart", {});
      await new Promise((r) => setTimeout(r, 300));
      await channelRef.current.unsubscribe();
    }
    await restartRoom(roomId);
    router.push(`/tv/host/${code}`);
    router.refresh();
  }

  // ============================================================
  // Vague U (#9) — Bouton "Skip pour [Pseudo]" côté TV (debug/régie).
  // Permet à l'hôte d'avancer à la place du joueur courant (compté
  // comme une mauvaise réponse). Utile quand un téléphone est planté
  // ou pour tester rapidement la mécanique des duels.
  //
  // On simule la réponse en :
  //  - CE/CPC playing : forge un `*:answer-submit` avec `chosenIdx`
  //    différent de `correctIdx`/`intrusIdx`, puis appelle le handler
  //  - Duel question : forge un `ce:duel-answer-submit` avec un
  //    `chosenIdx` faux → le candidat répond mal → le challenger survit
  //  - Autres phases (duel-select/theme, elim, podium) : bouton masqué
  // ============================================================
  function pickWrongIdx(correctIdx: number, length: number): number {
    if (length <= 1) return correctIdx; // edge case: pas d'autre choix
    return correctIdx === 0 ? 1 : 0;
  }

  function handleSkipCurrentPlayer() {
    const s = stateRef.current;
    const q = s.currentQuestion;
    if (!q) return;

    // CE playing : envoie un answer-submit "mauvais" (chosenIdx ≠ correctIdx)
    if (s.phase === "coup-envoi-playing" && isQuizzQuestion(q)) {
      const ct = s.turnOrder[s.currentPlayerIdx];
      if (!ct) return;
      handleCeAnswer({
        questionId: q.id,
        chosenIdx: pickWrongIdx(q.correctIdx, q.choices.length),
        playerToken: ct,
      });
      return;
    }
    // Vague V (#5) — CPC playing : on simule un clic sur l'intrus directement
    // (= mauvaise réponse, vie -1). C'est l'équivalent "Skip" en CPC continu.
    if (s.phase === "coup-par-coup-playing" && isCpcQuestion(q)) {
      const ct = s.turnOrder[s.currentPlayerIdx];
      if (!ct) return;
      handleCpcAnswer({
        questionId: q.id,
        chosenIdx: q.intrusIdx,
        playerToken: ct,
      });
      return;
    }
    // Duel question : envoie un duel-answer "mauvais" pour le candidat
    if (
      (s.phase === "coup-envoi-duel-question" ||
        s.phase === "coup-par-coup-duel-question") &&
      s.currentDuel?.candidateToken &&
      s.currentDuel.question
    ) {
      handleDuelAnswer({
        questionId: s.currentDuel.question.id,
        chosenIdx: pickWrongIdx(
          s.currentDuel.question.correctIdx,
          s.currentDuel.question.choices.length,
        ),
        candidateToken: s.currentDuel.candidateToken,
      });
    }
  }

  // Joueur courant dont on peut skip le tour (null si pas en phase
  // skippable). Le bouton n'est rendu que dans ce cas.
  const skipTargetPseudo = (() => {
    if (
      state.phase === "coup-envoi-playing" ||
      state.phase === "coup-par-coup-playing"
    ) {
      const t = state.turnOrder[state.currentPlayerIdx];
      return state.players.find((p) => p.token === t)?.pseudo ?? null;
    }
    if (
      (state.phase === "coup-envoi-duel-question" ||
        state.phase === "coup-par-coup-duel-question") &&
      state.currentDuel?.candidateToken
    ) {
      const t = state.currentDuel.candidateToken;
      return state.players.find((p) => p.token === t)?.pseudo ?? null;
    }
    return null;
  })();

  // ============================================================
  // RENDER : dispatch selon state.phase
  // ============================================================
  // Face-à-face (étape 3) — délégué à TvFaceAFaceView (P5)
  if (faState && state.phase !== "podium") {
    return (
      <TvFaceAFaceView
        code={code}
        roomId={roomId}
        initialState={faState}
        initialVersion={versionRef.current}
        players={playersWithPresenceRef.current.length > 0
          ? playersWithPresenceRef.current
          : state.players.map((p) => ({
              id: p.token,
              pseudo: p.pseudo,
              avatarUrl: p.avatarUrl,
              token: p.token,
              isConnected: true,
            }))}
        onEnd={() => setShowEndConfirm(true)}
      />
    );
  }

  if (state.phase === "podium" && state.finalRanking) {
    return (
      <TvPodiumView
        ranking={state.finalRanking}
        players={state.players}
        onRestart={handleRestart}
        onQuit={() => setShowEndConfirm(true)}
      />
    );
  }

  // Élimination overlay = au-dessus de la vue de la phase précédente
  const showEliminationOverlay =
    state.phase === "coup-envoi-elimination" ||
    state.phase === "coup-par-coup-elimination";
  const eliminatedPlayer = showEliminationOverlay
    ? state.players.find((p) => p.token === state.eliminationAnimation?.token)
    : null;

  // Phase 1 : Coup d'Envoi (sub-phases : playing OU duel-* OU élimination)
  const inCePhase =
    state.phase === "coup-envoi-playing" ||
    state.phase === "coup-envoi-duel-select" ||
    state.phase === "coup-envoi-duel-theme" ||
    state.phase === "coup-envoi-duel-question" ||
    state.phase === "coup-envoi-elimination";
  const inCpcPhase =
    state.phase === "coup-par-coup-playing" ||
    state.phase === "coup-par-coup-duel-select" ||
    state.phase === "coup-par-coup-duel-theme" ||
    state.phase === "coup-par-coup-duel-question" ||
    state.phase === "coup-par-coup-elimination";

  const inDuel = !!state.currentDuel;
  const challenger = inDuel
    ? state.players.find(
        (p) => p.token === state.currentDuel?.challengerToken,
      )
    : null;
  const candidate = inDuel && state.currentDuel?.candidateToken
    ? state.players.find((p) => p.token === state.currentDuel?.candidateToken)
    : null;
  const chosenTheme = state.currentDuel?.chosenThemeId
    ? state.currentDuel.proposedThemes.find(
        (t) => t.id === state.currentDuel?.chosenThemeId,
      )
    : null;

  const currentToken = state.turnOrder[state.currentPlayerIdx] ?? null;

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center justify-between text-foreground">
        <p className="text-sm font-bold uppercase tracking-widest text-gold-warm">
          Mode 12 Coups · Partie {code}
        </p>
        <div className="flex items-center gap-2">
          {skipTargetPseudo && (
            <button
              type="button"
              onClick={handleSkipCurrentPlayer}
              title={`Avancer à la place de ${skipTargetPseudo} (compte comme une mauvaise réponse)`}
              className="inline-flex items-center gap-1.5 rounded-md border border-foreground/20 bg-card px-3 py-1.5 text-xs font-semibold text-foreground/70 hover:border-foreground/40 hover:bg-foreground/5"
            >
              <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
              Skip {skipTargetPseudo}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowEndConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-buzz/30 bg-card px-3 py-1.5 text-xs font-semibold text-buzz hover:bg-buzz/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Terminer
          </button>
        </div>
      </header>

      {/* Vue de la phase courante (sous l'overlay si élimination) */}
      <AnimatePresence mode="wait">
        {inCePhase && !inDuel && (
          <TvCoupEnvoiView
            key="ce-playing"
            code={code}
            players={state.players}
            currentPlayerToken={currentToken}
            question={
              isQuizzQuestion(state.currentQuestion)
                ? (state.currentQuestion as QuizzQuestion)
                : null
            }
          />
        )}
        {inCpcPhase && !inDuel && (
          <TvCoupParCoupView
            key="cpc-playing"
            code={code}
            players={state.players}
            currentPlayerToken={currentToken}
            question={
              isCpcQuestion(state.currentQuestion)
                ? (state.currentQuestion as CpcQuestion)
                : null
            }
          />
        )}
        {inDuel && challenger && (
          <TvDuelView
            key="duel"
            phase={state.phase}
            challenger={challenger}
            candidate={candidate ?? null}
            proposedThemes={
              (state.currentDuel?.proposedThemes ?? []) as DuelTheme[]
            }
            chosenThemeNom={chosenTheme?.nom ?? null}
            question={state.currentDuel?.question ?? null}
          />
        )}
      </AnimatePresence>

      <EliminationOverlay
        visible={showEliminationOverlay && !!eliminatedPlayer}
        pseudo={eliminatedPlayer?.pseudo ?? ""}
        avatarUrl={eliminatedPlayer?.avatarUrl ?? null}
        fromPhase={
          state.phase === "coup-envoi-elimination"
            ? "coup-envoi"
            : "coup-par-coup"
        }
        nextPhase={
          state.phase === "coup-envoi-elimination"
            ? "coup-par-coup"
            : "face-a-face"
        }
      />

      {/* Vague V (#3) — Animations cinématiques 3s + 3s avant le duel-start.
          Set par `playDuelIntroAndStart`. */}
      <AnimatePresence>
        {orangeAnim && (
          <PlayerTurnsOrangeAnimation
            key="orange-anim"
            pseudo={orangeAnim.pseudo}
            avatarUrl={orangeAnim.avatarUrl}
          />
        )}
        {redAnim && (
          <PlayerTurnsRedAnimation
            key="red-anim"
            pseudo={redAnim.pseudo}
            avatarUrl={redAnim.avatarUrl}
          />
        )}
        {duelAnnounceAnim && <DuelAnnouncementAnimation key="duel-anim" />}
      </AnimatePresence>

      {/* Vague V (#7) — Modal "joueur a quitté" : déclenché 30s après une
          détection Presence leave. 3 options pour reprendre la partie. */}
      <AnimatePresence>
        {state.pausedReason === "player-left" && state.pausedPlayerPseudo && (
          <PlayerLeftModal
            key="player-left-modal"
            pseudo={state.pausedPlayerPseudo}
            busyAction={busyAbandon}
            onContinue={handleAbandonContinue}
            onWait={handleAbandonWait}
            onReplaceWithBot={handleAbandonReplaceWithBot}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={showEndConfirm}
        onClose={() => !ending && setShowEndConfirm(false)}
        onConfirm={handleEnd}
        isPending={ending}
        title="Mettre fin à la partie ?"
        description="Tous les joueurs vont être déconnectés. Cette action est irréversible."
        confirmLabel={ending ? "Fermeture…" : "Mettre fin"}
        confirmVariant="danger"
      />
    </main>
  );
}
