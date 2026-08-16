import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  computeLifeState,
  shouldTriggerFaceAFace,
  type Jeu1AnswerLog,
  type Jeu1Question,
} from "@/lib/game-logic/jeu1";
import type { LifeState } from "@/components/game/LifeBar";


// HOLA

export type GameMode =
  | "jeu1"
  | "coup_par_coup"
  | "etoile"
  | "face_a_face"
  | "coup_maitre"
  | "parcours"
  | "revision";

export type GameStatus =
  | "idle"
  | "intro"
  | "playing"
  | "feedback"
  | "results"
  | "gameover";

export interface AnswerOutcome {
  isCorrect: boolean;
  selectedIdx: number;
  correctIdx: number;
  isLastQuestion: boolean;
  gameOver: boolean;
  lifeState: LifeState;
}

interface GameState {
  // Méta
  mode: GameMode | null;
  status: GameStatus;
  startedAt: number; // ms epoch
  // Données
  questions: Jeu1Question[];
  currentIndex: number;
  wrongCount: number;
  correctCount: number;
  answers: Jeu1AnswerLog[];
  // UI feedback (post-réponse, avant question suivante)
  lastSelectedIdx: number | null;
  lastCorrectIdx: number | null;

  // Actions
  startJeu1(questions: Jeu1Question[]): void;
  beginPlay(): void;
  answerQuestion(selectedIdx: number, timeMs: number): AnswerOutcome;
  nextQuestion(): void;
  goToResults(): void;
  reset(): void;
}

const INITIAL: Omit<
  GameState,
  | "startJeu1"
  | "beginPlay"
  | "answerQuestion"
  | "nextQuestion"
  | "goToResults"
  | "reset"
> = {
  mode: null,
  status: "idle",
  startedAt: 0,
  questions: [],
  currentIndex: 0,
  wrongCount: 0,
  correctCount: 0,
  answers: [],
  lastSelectedIdx: null,
  lastCorrectIdx: null,
};

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      startJeu1(questions) {
        set({
          ...INITIAL,
          mode: "jeu1",
          status: "intro",
          questions,
          startedAt: Date.now(),
        });
      },

      beginPlay() {
        set({ status: "playing", startedAt: Date.now() });
      },

      answerQuestion(selectedIdx, timeMs) {
        const state = get();
        const q = state.questions[state.currentIndex];
        if (!q) {
          // Sécurité
          return {
            isCorrect: false,
            selectedIdx,
            correctIdx: 0,
            isLastQuestion: true,
            gameOver: true,
            lifeState: "red",
          };
        }
        const correctIdx = q.reponses.findIndex((r) => r.correct);
        const isCorrect = selectedIdx === correctIdx;
        const wrongCount = state.wrongCount + (isCorrect ? 0 : 1);
        const correctCount = state.correctCount + (isCorrect ? 1 : 0);
        const isLastQuestion = state.currentIndex >= state.questions.length - 1;
        const gameOver = shouldTriggerFaceAFace(wrongCount);
        const lifeState = computeLifeState(wrongCount);

        set({
          status: "feedback",
          wrongCount,
          correctCount,
          answers: [
            ...state.answers,
            { questionId: q.id, isCorrect, timeMs },
          ],
          lastSelectedIdx: selectedIdx,
          lastCorrectIdx: correctIdx,
        });

        return {
          isCorrect,
          selectedIdx,
          correctIdx,
          isLastQuestion,
          gameOver,
          lifeState,
        };
      },

      nextQuestion() {
        const state = get();
        if (state.currentIndex >= state.questions.length - 1) {
          set({ status: "results" });
          return;
        }
        set({
          currentIndex: state.currentIndex + 1,
          status: "playing",
          lastSelectedIdx: null,
          lastCorrectIdx: null,
        });
      },

      goToResults() {
        set({ status: "results" });
      },

      reset() {
        set({ ...INITIAL });
      },
    }),
    {
      name: "mm-game-store",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : sessionStorage,
      ),
      // Ne persiste que ce qui sert à reprendre une partie
      partialize: (s) => ({
        mode: s.mode,
        status: s.status,
        startedAt: s.startedAt,
        questions: s.questions,
        currentIndex: s.currentIndex,
        wrongCount: s.wrongCount,
        correctCount: s.correctCount,
        answers: s.answers,
        lastSelectedIdx: s.lastSelectedIdx,
        lastCorrectIdx: s.lastCorrectIdx,
      }),
    },
  ),
);
