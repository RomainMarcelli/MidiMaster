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
  type CpcQuestion,
  type DuelTheme,
  type QuizzQuestion,
  type TvDouzeCoupsState,
} from "@/lib/realtime/tv-douze-coups-state";
import {
  advanceTurn,
  applyAnswer,
  applyDuelAnswer,
  applyDuelCandidateSelection,
  applyDuelThemeSelection,
  endEliminationAnimation,
} from "./tv-douze-coups-machine-helpers";
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

  // Vague T (#3) — Les transitions pures (advanceTurn,
  // transitionAfterElimination, applyAnswer, applyDuelAnswer, etc.) sont
  // dans `tv-douze-coups-machine-helpers.ts` (testées en isolation, 22
  // tests). Ce composant n'orchestre plus que les side effects.

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
      const result = applyAnswer(stateRef.current, payload, kind);
      if (result.kind !== "accepted") return;
      const { isCorrect, correctIdx, next, triggersDuel, challengerPseudo } = result;

      // Broadcast résultat (typage des events distinct entre ce: et cpc:)
      if (kind === "ce") {
        ch.send("ce:question-result", {
          questionId: payload.questionId,
          byToken: payload.playerToken,
          chosenIdx: payload.chosenIdx,
          correctIdx,
          isCorrect,
        });
      } else {
        ch.send("cpc:question-result", {
          questionId: payload.questionId,
          byToken: payload.playerToken,
          chosenIdx: payload.chosenIdx,
          intrusIdx: correctIdx,
          isCorrect,
        });
      }

      // Persiste le state
      updateAndSave(() => next);

      if (triggersDuel) {
        ch.send("ce:duel-start", {
          challengerToken: payload.playerToken,
          challengerPseudo: challengerPseudo ?? "?",
        });
        // Vague S3 — Si le challenger (joueur rouge) est un bot, il
        // choisit automatiquement un candidat parmi les vivants ≠ lui.
        const challenger = next.players.find(
          (p) => p.token === payload.playerToken,
        );
        if (challenger && (challenger.isBot || isBotToken(payload.playerToken))) {
          const candidates = next.players.map((p) => ({
            token: p.token,
            isEliminated: p.isEliminated,
          }));
          const candToken = pickBotDuelCandidate(candidates, payload.playerToken);
          if (candToken) {
            const cand = next.players.find((p) => p.token === candToken);
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
        // Pas de duel : avance au tour suivant après le délai d'affichage
        // du résultat.
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
      updateAndSave((prev) =>
        applyDuelCandidateSelection(prev, payload.candidateToken, themes),
      );
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
      updateAndSave((prev) => applyDuelThemeSelection(prev, payload.themeId, q));
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

    // Vague T (#4) — Validation Zod à la réception : un téléphone qui
    // envoie un payload mal formé (vieux build, manipulation) est ignoré
    // silencieusement avec un log côté hôte.
    ch.on("ce:answer-submit", (p) => {
      const parsed = safeParseEvent("ce:answer-submit", ceAnswerSubmitSchema, p);
      if (parsed) handleNormalAnswer(parsed, "ce");
    });
    ch.on("cpc:answer-submit", (p) => {
      const parsed = safeParseEvent("cpc:answer-submit", cpcAnswerSubmitSchema, p);
      if (parsed) handleNormalAnswer(parsed, "cpc");
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

    // CE / CPC playing : envoie un answer-submit "mauvais"
    if (s.phase === "coup-envoi-playing" && isQuizzQuestion(q)) {
      const ct = s.turnOrder[s.currentPlayerIdx];
      if (!ct) return;
      handleNormalAnswer(
        {
          questionId: q.id,
          chosenIdx: pickWrongIdx(q.correctIdx, q.choices.length),
          playerToken: ct,
        },
        "ce",
      );
      return;
    }
    if (s.phase === "coup-par-coup-playing" && isCpcQuestion(q)) {
      const ct = s.turnOrder[s.currentPlayerIdx];
      if (!ct) return;
      handleNormalAnswer(
        {
          questionId: q.id,
          chosenIdx: pickWrongIdx(q.intrusIdx, q.propositions.length),
          playerToken: ct,
        },
        "cpc",
      );
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
