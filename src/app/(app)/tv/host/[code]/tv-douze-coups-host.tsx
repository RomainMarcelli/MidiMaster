"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
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
  applyAnswerToPlayer,
  buildFinalRanking,
  isCpcQuestion,
  isQuizzQuestion,
  markFinalists,
  nextActivePlayerIdx,
  resolveDuel,
  type CpcQuestion,
  type DcPlayer,
  type DuelTheme,
  type QuizzQuestion,
  type TvDouzeCoupsState,
} from "@/lib/realtime/tv-douze-coups-state";
import { endTvRoom } from "@/lib/realtime/room-actions";
import {
  isBotToken,
  pickBotAnswerIdx,
  pickBotDelayMs,
  pickBotDuelCandidate,
  pickBotDuelTheme,
} from "@/lib/realtime/bot-behavior";
import { TvCoupEnvoiView } from "./tv-coup-envoi-view";
import { TvCoupParCoupView } from "./tv-coup-par-coup-view";
import { TvDuelView } from "./tv-duel-view";
import { TvPodiumView } from "./tv-podium-view";
import { EliminationOverlay } from "@/components/tv/EliminationOverlay";
import { prepareFaceAFace } from "@/lib/realtime/face-a-face-actions";
import type { FaceAFaceState } from "@/lib/realtime/face-a-face-state";
import { TvFaceAFaceView } from "./tv-face-a-face-view";

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

export function TvDouzeCoupsHost({
  code,
  roomId,
  initialState,
}: {
  code: string;
  roomId: string;
  initialState: TvDouzeCoupsState;
}) {
  const router = useRouter();
  const [state, setState] = useState<TvDouzeCoupsState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const channelRef = useRef<TvChannelHandle | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [faState, setFaState] = useState<FaceAFaceState | null>(null);
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
      void saveDouzeCoupsState({ roomId, state: next });
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
      // Bot : simulation de réponse (cherche l'intrus)
      if (currentPlayer.isBot || isBotToken(currentToken)) {
        const skill = currentPlayer.botSkill ?? 70;
        const chosenIdx = pickBotAnswerIdx(
          q.propositions.length,
          q.intrusIdx,
          skill,
        );
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
  }, []);

  // ============================================================
  // Avance au prochain joueur (en sautant les éliminés). NE FAIT
  // PAS de transition de phase — c'est `transitionAfterElimination`
  // qui s'en charge UNIQUEMENT après une élimination effective.
  //
  // S1.2 — Bug corrigé : avant, advanceTurn vérifiait `alive.length
  // <= 3` à chaque tour. Avec une partie démarrée à 2 ou 3 joueurs,
  // cette condition était vraie dès la 1ère réponse correcte → on
  // basculait en CPC, puis FA, puis podium en cascade.
  // Désormais : advanceTurn ne fait QUE l'avancement de tour de
  // table normal. Les transitions de phase sont déclenchées
  // explicitement par transitionAfterElimination().
  // ============================================================
  const advanceTurn = useCallback(
    (s: TvDouzeCoupsState): TvDouzeCoupsState => {
      const nextIdx = nextActivePlayerIdx(
        s.currentPlayerIdx,
        s.turnOrder,
        s.players,
      );
      if (s.phase === "coup-envoi-playing") {
        const nextQuestion = s.questionPool.coupEnvoi[0] ?? null;
        return {
          ...s,
          currentPlayerIdx: nextIdx === -1 ? s.currentPlayerIdx : nextIdx,
          currentQuestion: nextQuestion,
          questionPool: {
            ...s.questionPool,
            coupEnvoi: s.questionPool.coupEnvoi.slice(1),
          },
        };
      }
      const nextQuestion = s.questionPool.coupParCoup[0] ?? null;
      return {
        ...s,
        currentPlayerIdx: nextIdx === -1 ? s.currentPlayerIdx : nextIdx,
        currentQuestion: nextQuestion,
        questionPool: {
          ...s.questionPool,
          coupParCoup: s.questionPool.coupParCoup.slice(1),
        },
      };
    },
    [],
  );

  /**
   * Décide si une élimination doit déclencher un changement de phase.
   * Appelée APRÈS une élimination effective (handleDuelAnswer avec
   * candidat correct). Règles :
   *  - Phase Coup d'Envoi : 1 éliminé → 3 survivants → CPC
   *  - Phase Coup par Coup : 1 éliminé → 2 survivants → Face-à-Face
   *
   * Retourne le state mis à jour avec la nouvelle phase, OU `null`
   * si pas de transition (la partie continue dans la même phase).
   */
  const transitionAfterElimination = useCallback(
    (s: TvDouzeCoupsState): TvDouzeCoupsState | null => {
      const alive = s.players.filter((p) => !p.isEliminated);
      // CE → CPC : on a perdu un joueur en CE, il en reste 3 (ou moins)
      if (
        (s.phase === "coup-envoi-playing" ||
          s.phase === "coup-envoi-elimination") &&
        alive.length <= 3
      ) {
        const newTurnOrder = alive.map((p) => p.token);
        const firstQ = s.questionPool.coupParCoup[0] ?? null;
        return {
          ...s,
          phase: "coup-par-coup-playing",
          turnOrder: newTurnOrder,
          currentPlayerIdx: 0,
          currentQuestion: firstQ,
          questionPool: {
            ...s.questionPool,
            coupParCoup: s.questionPool.coupParCoup.slice(1),
          },
        };
      }
      // CPC → FA : on a perdu un joueur en CPC, il en reste 2
      if (
        (s.phase === "coup-par-coup-playing" ||
          s.phase === "coup-par-coup-elimination") &&
        alive.length <= 2
      ) {
        return {
          ...s,
          phase: "face-a-face-vote",
          players: markFinalists(s.players),
        };
      }
      return null;
    },
    [],
  );

  // ============================================================
  // Gestion d'une réponse à une question normale (Coup d'Envoi
  // ou Coup par Coup). Vérifie la bonne réponse, met à jour la
  // vie, broadcast le résultat, et :
  //  - si vie passe rouge : démarre un duel
  //  - sinon : avance au tour suivant après RESULT_DELAY_MS
  // ============================================================
  const handleNormalAnswer = useCallback(
    (
      payload: { questionId: string; chosenIdx: number; playerToken: string },
      kind: "ce" | "cpc",
    ) => {
      const ch = channelRef.current;
      if (!ch) return;
      const s = stateRef.current;
      const expectedToken = s.turnOrder[s.currentPlayerIdx];
      if (payload.playerToken !== expectedToken) return;
      const q = s.currentQuestion;
      if (!q || q.id !== payload.questionId) return;

      const correctIdx = isQuizzQuestion(q) ? q.correctIdx : q.intrusIdx;
      const isCorrect = payload.chosenIdx === correctIdx;
      const player = s.players.find((p) => p.token === payload.playerToken);
      if (!player) return;
      const updatedPlayer = applyAnswerToPlayer(player, isCorrect);

      // Broadcast résultat
      if (kind === "ce") {
        ch.send("ce:question-result", {
          questionId: q.id,
          byToken: payload.playerToken,
          chosenIdx: payload.chosenIdx,
          correctIdx,
          isCorrect,
        });
      } else {
        ch.send("cpc:question-result", {
          questionId: q.id,
          byToken: payload.playerToken,
          chosenIdx: payload.chosenIdx,
          intrusIdx: correctIdx,
          isCorrect,
        });
      }

      // Patch joueur dans state
      const playersAfter = s.players.map((p) =>
        p.token === payload.playerToken ? updatedPlayer : p,
      );
      const justWentRed =
        player.lifeStatus !== "red" && updatedPlayer.lifeStatus === "red";

      if (justWentRed) {
        // Démarrer un duel : phase change immédiatement, broadcast ce:duel-start
        const duelPhase =
          kind === "ce"
            ? "coup-envoi-duel-select"
            : "coup-par-coup-duel-select";
        updateAndSave((prev) => ({
          ...prev,
          players: playersAfter,
          phase: duelPhase,
          currentDuel: {
            challengerToken: payload.playerToken,
            candidateToken: null,
            proposedThemes: [],
            chosenThemeId: null,
            question: null,
          },
        }));
        ch.send("ce:duel-start", {
          challengerToken: payload.playerToken,
          challengerPseudo: updatedPlayer.pseudo,
        });
        // Vague S3 — Si le challenger (joueur rouge) est un bot, il
        // choisit automatiquement un candidat parmi les vivants ≠ lui.
        if (updatedPlayer.isBot || isBotToken(payload.playerToken)) {
          const candidates = playersAfter.map((p) => ({
            token: p.token,
            isEliminated: p.isEliminated,
          }));
          const candToken = pickBotDuelCandidate(candidates, payload.playerToken);
          if (candToken) {
            const cand = playersAfter.find((p) => p.token === candToken);
            if (cand) {
              const delay = pickBotDelayMs(undefined, 1500, 2500);
              window.setTimeout(() => {
                ch.send("ce:duel-candidate-selected", {
                  challengerToken: payload.playerToken,
                  candidateToken: candToken,
                  candidatePseudo: cand.pseudo,
                });
              }, delay);
            }
          }
        }
      } else {
        // Patch d'abord, puis avance au tour suivant après délai
        updateAndSave((prev) => ({ ...prev, players: playersAfter }));
        window.setTimeout(() => {
          updateAndSave((prev) => {
            const advanced = advanceTurn(prev);
            // Broadcast la prochaine question dans le frame suivant
            window.setTimeout(() => broadcastCurrent(advanced), 0);
            return advanced;
          });
        }, RESULT_DELAY_MS);
      }
    },
    [updateAndSave, advanceTurn, broadcastCurrent],
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
      // Tire 2 thèmes via server action (tirage côté serveur)
      const themes = await pickDuelThemesAction(code);
      const themePhase =
        stateRef.current.phase === "coup-envoi-duel-select"
          ? "coup-envoi-duel-theme"
          : "coup-par-coup-duel-theme";
      updateAndSave((prev) => ({
        ...prev,
        phase: themePhase,
        currentDuel: prev.currentDuel
          ? {
              ...prev.currentDuel,
              candidateToken: payload.candidateToken,
              proposedThemes: themes,
            }
          : null,
      }));
      ch.send("ce:duel-theme-proposals", {
        candidateToken: payload.candidateToken,
        themes,
      });
      // Vague S3 — Si le candidat est un bot, il choisit un thème au hasard
      const candidate = stateRef.current.players.find(
        (p) => p.token === payload.candidateToken,
      );
      if (candidate && (candidate.isBot || isBotToken(payload.candidateToken))) {
        const themeId = pickBotDuelTheme(themes);
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
      const q = await pickDuelQuestion(payload.themeId);
      if (!q) return;
      const questionPhase =
        stateRef.current.phase === "coup-envoi-duel-theme"
          ? "coup-envoi-duel-question"
          : "coup-par-coup-duel-question";
      updateAndSave((prev) => ({
        ...prev,
        phase: questionPhase,
        currentDuel: prev.currentDuel
          ? {
              ...prev.currentDuel,
              chosenThemeId: payload.themeId,
              question: q,
            }
          : null,
      }));
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
      const s = stateRef.current;
      const duel = s.currentDuel;
      if (!duel || !duel.question || duel.question.id !== payload.questionId) {
        return;
      }
      if (payload.candidateToken !== duel.candidateToken) return;
      const candidateCorrect = payload.chosenIdx === duel.question.correctIdx;
      const phaseKind = s.phase.startsWith("coup-envoi") ? "coup-envoi" : "coup-par-coup";
      const playersAfter = resolveDuel(
        s.players,
        duel.challengerToken,
        duel.candidateToken,
        candidateCorrect,
        phaseKind,
      );
      const challengerEliminated = !!playersAfter.find(
        (p) => p.token === duel.challengerToken,
      )?.isEliminated;

      ch.send("ce:duel-result", {
        questionId: duel.question.id,
        candidateToken: duel.candidateToken,
        challengerToken: duel.challengerToken,
        chosenIdx: payload.chosenIdx,
        correctIdx: duel.question.correctIdx,
        candidateCorrect,
        challengerEliminated,
      });

      if (challengerEliminated) {
        // Animation d'élimination 4.5s, puis transition de phase
        const eliminated = playersAfter.find(
          (p) => p.token === duel.challengerToken,
        )!;
        const elimPhase =
          phaseKind === "coup-envoi"
            ? "coup-envoi-elimination"
            : "coup-par-coup-elimination";
        updateAndSave((prev) => ({
          ...prev,
          players: playersAfter,
          currentDuel: null,
          phase: elimPhase,
          eliminationAnimation: {
            token: duel.challengerToken,
            startedAt: Date.now(),
            durationMs: ELIM_ANIM_MS,
          },
        }));
        ch.send("ce:elimination", {
          eliminatedToken: duel.challengerToken,
          eliminatedPseudo: eliminated.pseudo,
          fromPhase: phaseKind,
          nextPhase: phaseKind === "coup-envoi" ? "coup-par-coup" : "face-a-face",
        });
        window.setTimeout(() => {
          // Après élimination effective : on tente une transition de
          // phase (CE→CPC ou CPC→FA). Si pas de transition (cas où on
          // a éliminé un joueur mais on est encore au-dessus du seuil),
          // on reste dans la phase et on avance le tour normalement.
          const back: TvDouzeCoupsState = {
            ...stateRef.current,
            phase:
              phaseKind === "coup-envoi"
                ? "coup-envoi-playing"
                : "coup-par-coup-playing",
            eliminationAnimation: null,
          };
          const transitioned = transitionAfterElimination(back);
          const next = transitioned ?? advanceTurn(back);
          stateRef.current = next;
          setState(next);
          void saveDouzeCoupsState({ roomId, state: next });
          window.setTimeout(() => broadcastCurrent(next), 0);
        }, ELIM_ANIM_MS);
      } else {
        // Le challenger survit, retour direct au tour suivant après le délai
        updateAndSave((prev) => ({
          ...prev,
          players: playersAfter,
          currentDuel: null,
        }));
        window.setTimeout(() => {
          const back: TvDouzeCoupsState = {
            ...stateRef.current,
            phase:
              phaseKind === "coup-envoi"
                ? "coup-envoi-playing"
                : "coup-par-coup-playing",
          };
          const advanced = advanceTurn(back);
          stateRef.current = advanced;
          setState(advanced);
          void saveDouzeCoupsState({ roomId, state: advanced });
          window.setTimeout(() => broadcastCurrent(advanced), 0);
        }, RESULT_DELAY_MS);
      }
    },
    [updateAndSave, advanceTurn, broadcastCurrent, transitionAfterElimination, roomId],
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
      void finalizeDouzeCoupsTv({ roomId, state: s, winnerToken });
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
          }
        }
      }
      playersWithPresenceRef.current = list;
    });

    ch.on("ce:answer-submit", (p) => handleNormalAnswer(p, "ce"));
    ch.on("cpc:answer-submit", (p) => handleNormalAnswer(p, "cpc"));
    ch.on("ce:duel-candidate-selected", (p) => {
      void handleDuelCandidateSelected(p);
    });
    ch.on("ce:duel-theme-chosen", (p) => {
      void handleDuelThemeChosen(p);
    });
    ch.on("ce:duel-answer-submit", (p) => handleDuelAnswer(p));
    // À la fin du face-à-face, on construit le podium.
    ch.on("fa:end", (p) => handleFaEnded(p.winnerToken));

    // Premier broadcast après que le channel soit subscribed
    window.setTimeout(() => broadcastCurrent(stateRef.current), 600);

    return () => {
      unbindPresence();
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
      if (res.ok) setFaState(res.state);
    });
  }, [state.phase, state.players, roomId, faState]);

  // ============================================================
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
  // RENDER : dispatch selon state.phase
  // ============================================================
  // Face-à-face (étape 3) — délégué à TvFaceAFaceView (P5)
  if (faState && state.phase !== "podium") {
    return (
      <TvFaceAFaceView
        code={code}
        roomId={roomId}
        initialState={faState}
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
        <button
          type="button"
          onClick={() => setShowEndConfirm(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-buzz/30 bg-card px-3 py-1.5 text-xs font-semibold text-buzz hover:bg-buzz/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Terminer
        </button>
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
