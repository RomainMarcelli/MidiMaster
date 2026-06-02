"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Calendar,
  Flag,
  FlaskConical,
  GraduationCap,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Star,
  Timer,
  Trophy,
} from "lucide-react";
import dynamic from "next/dynamic";
// I1.1 — Lazy-load : ne charge l'iframe + Framer Motion du modal que
// quand l'utilisateur clique réellement sur "Drapeaux & Capitales".
const FlagoraEmbedModal = dynamic(
  () =>
    import("@/components/revision/FlagoraEmbedModal").then(
      (m) => m.FlagoraEmbedModal,
    ),
  { ssr: false },
);
import { fetchFavorites } from "@/app/(app)/favoris/actions";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionType } from "@/types/database";
import type { RevQuestion } from "@/lib/revision/types";
import {
  fetchDailyChallenge,
  fetchFiche,
  fetchQuestionsForRevision,
} from "./actions";
import { QuizPlayer } from "./_components/QuizPlayer";
import { FlashcardPlayer } from "./_components/FlashcardPlayer";
import { ErrorsReader } from "./_components/ErrorsReader";
import { FavoriteIdsContext } from "./_components/favorite-ids-context";
import { DefiAvailabilityBadge } from "./_components/DefiAvailabilityBadge";
import {
  ReviewBatcherContext,
  type ReviewBatcherValue,
} from "./_components/review-batcher-context";
import { markErrorsAsReviewed } from "./actions";
import { shuffle } from "@/lib/utils/array";
import { pushRecentIds, readRecentIds } from "@/lib/revision/recent-ids";

export interface CategoryRow {
  id: number;
  nom: string;
  slug: string;
  couleur: string | null;
}

export interface RevisionClientProps {
  categories: CategoryRow[];
  wrongQuestions: RevQuestion[];
  totalQuestionsAvailable: number;
  /** I1.5 — IDs des questions favorites (étoile remplie partout). */
  favoriteIds: string[];
  /** M4.1 — Le défi du jour existe-t-il dans daily_challenges ? */
  defiAvailable: boolean;
  /** M4.1 — Le user a-t-il déjà soumis son résultat aujourd'hui ? */
  defiPlayedToday: boolean;
}

type Mode =
  | "hub"
  | "retravailler"
  | "erreurs-lecture"
  | "apprendre"
  | "flashcards"
  | "marathon"
  | "marathon-libre"
  | "defi"
  | "fiche"
  | "favoris";

const TYPE_LABEL: Record<QuestionType, string> = {
  quizz_2: "Vrai/Faux & Choix",
  quizz_4: "4 propositions",
  etoile: "Étoile",
  face_a_face: "Texte libre",
  coup_maitre: "Coup de Maître",
  coup_par_coup: "Intrus",
};

const VALID_MODES: ReadonlyArray<Mode> = [
  "hub",
  "retravailler",
  "erreurs-lecture",
  "apprendre",
  "flashcards",
  "marathon",
  "marathon-libre",
  "defi",
  "fiche",
  "favoris",
];

export function RevisionClient(props: RevisionClientProps) {
  // J1.1 — URL = source de vérité unique pour `mode`.
  //
  // Avant : useState(mode) + useEffect [searchParams] resync. Bug : le
  // useEffect se déclenchait après une revalidatePath (qui change la
  // référence de searchParams sans changer l'URL) et résettait mode
  // depuis une URL stale → utilisateur éjecté vers retravailler en
  // plein Marathon. Détails : docs/BUG_J1_1_INVESTIGATION.md.
  //
  // Après : mode est dérivé directement de l'URL, et `setMode` fait
  // toujours un `router.push`. URL et UI restent toujours synchros.
  const searchParams = useSearchParams();
  const router = useRouter();
  // I1.5 — Set figé des IDs favoris, partagé à tous les QuizPlayer enfants
  // via FavoriteIdsContext.
  const favoriteIdSet = new Set(props.favoriteIds);

  const urlMode = searchParams.get("mode");
  const mode: Mode =
    urlMode && (VALID_MODES as ReadonlyArray<string>).includes(urlMode)
      ? (urlMode as Mode)
      : "hub";

  // J1.2 — File centrale pour le batcher de "marquer comme révisé".
  // QuizPlayer y pousse via le contexte ; le bouton "Retour aux modes"
  // appelle flush() avant de naviguer pour éviter de perdre les bonnes
  // réponses non encore validées par "Suivant".
  const pendingReviewedRef = useRef<Set<string>>(new Set());

  const reviewBatcher: ReviewBatcherValue = useMemo(
    () => ({
      addPending: (id: string) => {
        pendingReviewedRef.current.add(id);
      },
      flush: () => {
        if (pendingReviewedRef.current.size === 0) return;
        const ids = Array.from(pendingReviewedRef.current);
        pendingReviewedRef.current = new Set();
        // Fire-and-forget : on ne bloque pas la navigation sur l'aller-
        // retour serveur. Si l'INSERT/DELETE échoue côté BDD, le user
        // garde ses erreurs en mémoire — pas pire qu'avant.
        void markErrorsAsReviewed(ids);
      },
      flushViaBeacon: () => {
        const ids = Array.from(pendingReviewedRef.current);
        if (ids.length === 0) return;
        pendingReviewedRef.current = new Set();
        const blob = new Blob([JSON.stringify({ questionIds: ids })], {
          type: "application/json",
        });
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/revision/mark-reviewed", blob);
        } else {
          void fetch("/api/revision/mark-reviewed", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ questionIds: ids }),
            keepalive: true,
          }).catch(() => undefined);
        }
      },
    }),
    [],
  );

  // J1.2 — beforeunload / pagehide / visibilitychange remontés ici
  // (avant : dans QuizPlayer). On profite du provider parent : couvre
  // tous les modes, pas seulement quand QuizPlayer est monté.
  useEffect(() => {
    function flushBeacon() {
      reviewBatcher.flushViaBeacon();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushBeacon();
    }
    window.addEventListener("beforeunload", flushBeacon);
    window.addEventListener("pagehide", flushBeacon);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushBeacon);
      window.removeEventListener("pagehide", flushBeacon);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reviewBatcher]);

  const setMode = useCallback(
    (newMode: Mode) => {
      // J1.2 — Flush immédiat avant toute navigation : si l'utilisateur
      // a répondu correctement à une question en mode Refaire mais n'a
      // pas cliqué "Suivant", on déclenche maintenant le DELETE BDD.
      reviewBatcher.flush();
      if (newMode === "hub") {
        // J1.4 — "Retour aux modes" → URL nettoyée, plus de query stale.
        router.push("/revision");
      } else {
        router.push(`/revision?mode=${newMode}`);
      }
    },
    [router, reviewBatcher],
  );

  if (mode === "hub") {
    return (
      <ReviewBatcherContext.Provider value={reviewBatcher}>
        <FavoriteIdsContext.Provider value={favoriteIdSet}>
          <Hub onPick={setMode} props={props} />
        </FavoriteIdsContext.Provider>
      </ReviewBatcherContext.Provider>
    );
  }

  // G1.2 — Le `key` basé sur l'URL force un remount à chaque navigation
  // (notamment quand le bouton "Refaire mes erreurs" pointe vers
  // `?mode=retravailler&t=<timestamp>` : changer le timestamp suffit
  // à recharger un nouveau lot de questions / réinitialiser l'état).
  const remountKey = searchParams.toString();

  return (
    <ReviewBatcherContext.Provider value={reviewBatcher}>
    <FavoriteIdsContext.Provider value={favoriteIdSet}>
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-4xl px-4 pt-4">
          <button
            type="button"
            onClick={() => setMode("hub")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground/80 hover:border-gold/50 hover:bg-gold/10"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Retour aux modes
          </button>
        </div>

        {mode === "retravailler" && (
          <RetravaillerMode key={remountKey} questions={props.wrongQuestions} />
        )}
        {mode === "erreurs-lecture" && (
          <ErrorsReader key={remountKey} questions={props.wrongQuestions} />
        )}
        {mode === "apprendre" && <ApprendreMode categories={props.categories} />}
        {mode === "flashcards" && (
          <FlashcardsMode categories={props.categories} />
        )}
        {mode === "marathon" && <MarathonMode categories={props.categories} />}
        {mode === "marathon-libre" && <MarathonLibreMode />}
        {mode === "defi" && <DefiMode />}
        {mode === "fiche" && <FicheMode categories={props.categories} />}
        {mode === "favoris" && <FavorisMode />}
      </div>
    </FavoriteIdsContext.Provider>
    </ReviewBatcherContext.Provider>
  );
}

// ===========================================================================
// HUB
// ===========================================================================

function Hub({
  onPick,
  props,
}: {
  onPick: (m: Mode) => void;
  props: RevisionClientProps;
}) {
  const wrongCount = props.wrongQuestions.length;
  const total = props.totalQuestionsAvailable;
  const [showFlagora, setShowFlagora] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-life-green/15 text-life-green">
          <Brain className="h-10 w-10" aria-hidden="true" />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-life-green">
          Mode Révision
        </p>
        <h1 className="font-display text-4xl font-extrabold text-foreground">
          Apprends, révise, progresse
        </h1>
        <p className="max-w-xl text-foreground/70">
          Choisis ta façon d&apos;apprendre. Toutes les questions de la base
          sont disponibles ({total} actives).
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ModeCard
          title="Voir mes erreurs"
          desc={
            wrongCount > 0
              ? `${wrongCount} question${wrongCount > 1 ? "s" : ""} ratée${wrongCount > 1 ? "s" : ""} — lecture seule`
              : "Aucune erreur en mémoire"
          }
          icon={BookOpen}
          accent="buzz"
          onClick={() => onPick("erreurs-lecture")}
          disabled={wrongCount === 0}
        />
        <ModeCard
          title="Refaire mes erreurs"
          desc={
            wrongCount > 0
              ? `Rejoue les ${wrongCount} question${wrongCount > 1 ? "s" : ""} ratée${wrongCount > 1 ? "s" : ""}`
              : "Aucune erreur en mémoire"
          }
          icon={RotateCcw}
          accent="buzz"
          highlight={wrongCount > 0}
          onClick={() => onPick("retravailler")}
          disabled={wrongCount === 0}
        />
        <ModeCard
          title="Apprendre"
          desc="Quiz libre par catégorie / difficulté / type"
          icon={GraduationCap}
          accent="gold"
          onClick={() => onPick("apprendre")}
        />
        <ModeCard
          title="Flashcards"
          desc="Recto/verso : Acquise / À revoir"
          icon={Layers}
          accent="sky"
          onClick={() => onPick("flashcards")}
        />
        <ModeCard
          title="Marathon"
          desc="Enchaîne 50+ questions sans timer"
          icon={Timer}
          accent="life-green"
          onClick={() => onPick("marathon")}
        />
        <ModeCard
          title="Marathon libre"
          desc="50 questions à réponse 100 % libre (texte au clavier)"
          icon={Timer}
          accent="sky"
          onClick={() => onPick("marathon-libre")}
        />
        <ModeCard
          title="Défi du jour"
          desc="10 questions identiques pour tous, chaque jour"
          icon={Calendar}
          accent="gold"
          href="/revision/defi"
          badge={
            <DefiAvailabilityBadge
              defiAvailable={props.defiAvailable}
              defiPlayedToday={props.defiPlayedToday}
            />
          }
        />
        <ModeCard
          title="Fiches de révision"
          desc="Apprends carte par carte avec révélation guidée"
          icon={BookOpen}
          accent="sky"
          href="/revision/fiches"
        />
        <ModeCard
          title="Tableau périodique"
          desc="118 éléments à apprendre ou à retrouver"
          icon={FlaskConical}
          accent="sky"
          href="/revision/tableau-periodique"
        />
        <ModeCard
          title="Drapeaux & Capitales"
          desc="App externe Flagora (intégrée)"
          icon={Flag}
          accent="sky"
          onClick={() => setShowFlagora(true)}
        />
        <ModeCard
          title="Favoris"
          desc="Tes questions étoilées en révision dédiée"
          icon={Star}
          accent="gold"
          onClick={() => onPick("favoris")}
        />
      </div>
      <FlagoraEmbedModal
        open={showFlagora}
        onClose={() => setShowFlagora(false)}
      />
    </main>
  );
}

function ModeCard({
  title,
  desc,
  icon: Icon,
  accent,
  highlight,
  disabled,
  onClick,
  href,
  badge,
}: {
  title: string;
  desc: string;
  icon: typeof Brain;
  accent: "gold" | "sky" | "buzz" | "life-green";
  highlight?: boolean;
  disabled?: boolean;
  /** Si fourni → bouton classique. Sinon utiliser `href`. Mutuellement exclusif. */
  onClick?: () => void;
  /** Si fourni → la card devient un Link Next vers cette URL. */
  href?: string;
  /** M4.1 — Badge top-right (ex. "Disponible !" / "Joué"). */
  badge?: React.ReactNode;
}) {
  const accentClass = {
    gold: {
      bg: "bg-gold/15 text-gold-warm",
      border: "hover:border-gold/50",
      shadow: "hover:shadow-[0_0_24px_rgba(245,183,0,0.25)]",
    },
    sky: {
      bg: "bg-sky/15 text-sky",
      border: "hover:border-sky/50",
      shadow: "hover:shadow-[0_0_24px_rgba(43,142,230,0.25)]",
    },
    buzz: {
      bg: "bg-buzz/15 text-buzz",
      border: "hover:border-buzz/50",
      shadow: "hover:shadow-[0_0_24px_rgba(230,57,70,0.25)]",
    },
    "life-green": {
      bg: "bg-life-green/15 text-life-green",
      border: "hover:border-life-green/50",
      shadow: "hover:shadow-[0_0_24px_rgba(46,204,113,0.25)]",
    },
  }[accent];

  const containerCls = cn(
    "group relative flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-left transition-all glow-card",
    disabled
      ? "border-border opacity-50 cursor-not-allowed"
      : cn(
          "border-border hover:scale-[1.02]",
          accentClass.border,
          accentClass.shadow,
        ),
    highlight && "border-buzz/60",
  );
  const inner = (
    <>
      <div
        className={cn(
          // M3.1 — Bump h-12 → h-16 sm:h-20 pour homogénéité avec /jouer.
          "flex h-16 w-16 items-center justify-center rounded-xl transition-transform group-hover:scale-110 sm:h-20 sm:w-20",
          accentClass.bg,
        )}
      >
        <Icon className="h-8 w-8 sm:h-10 sm:w-10" aria-hidden="true" />
      </div>
      <div>
        <h3 className="font-display text-lg font-bold text-foreground">
          {title}
        </h3>
        <p className="mt-1 text-sm text-foreground/70">{desc}</p>
      </div>
      {highlight && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-buzz/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-buzz">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Recommandé
        </span>
      )}
      {badge && (
        <span className="absolute right-3 top-3 z-10">{badge}</span>
      )}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={containerCls}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={containerCls}
    >
      {inner}
    </button>
  );
}

// ===========================================================================
// MODE 1 — À retravailler (questions ratées)
// ===========================================================================

function RetravaillerMode({ questions }: { questions: RevQuestion[] }) {
  if (questions.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <Trophy className="h-12 w-12 text-life-green" aria-hidden="true" fill="currentColor" />
        <h1 className="font-display text-2xl font-extrabold text-foreground">
          Aucune question à retravailler.
        </h1>
        <p className="text-foreground/70">
          Joue quelques parties pour faire remonter tes points faibles ici.
        </p>
      </main>
    );
  }
  return <RetravaillerInner questions={questions} />;
}

/**
 * Wrapper extrait pour pouvoir utiliser `useRouter` (hook → composant
 * client). Le bouton "Voir mes erreurs (lecture)" génère le timestamp
 * AU CLIC, pas au render — sinon hydration mismatch (le timestamp
 * serveur ≠ client).
 */
function RetravaillerInner({ questions }: { questions: RevQuestion[] }) {
  const router = useRouter();
  // I1.4 — Ordre aléatoire à chaque montage. Le `key` du parent
  // (basé sur l'URL ?t=…) garantit un remount à chaque navigation
  // → un nouveau shuffle est calculé. useState(initialiser) évite
  // de re-mélanger à chaque re-render dans la même session.
  const [shuffled] = useState(() => shuffle(questions));
  return (
    <div className="flex flex-col gap-2">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-end px-4 pt-2">
        <button
          type="button"
          onClick={() =>
            router.push(`/revision?mode=erreurs-lecture&t=${Date.now()}`)
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-buzz/40 bg-buzz/5 px-3 text-xs font-bold text-buzz transition-colors hover:border-buzz hover:bg-buzz/10"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Voir mes erreurs (lecture)
        </button>
      </div>
      <QuizPlayer questions={shuffled} trackWrong removeOnCorrect />
    </div>
  );
}

// ===========================================================================
// MODE 2 — Apprendre (quiz configurable)
// ===========================================================================

function ApprendreMode({ categories }: { categories: CategoryRow[] }) {
  return (
    <ConfigAndPlay
      categories={categories}
      defaultCount={10}
      mode="quiz"
      heroTitle="Apprendre"
      heroSubtitle="Choisis tes filtres et c'est parti."
    />
  );
}

// ===========================================================================
// MODE 3 — Flashcards
// ===========================================================================

function FlashcardsMode({ categories }: { categories: CategoryRow[] }) {
  return (
    <ConfigAndPlay
      categories={categories}
      defaultCount={20}
      mode="flashcards"
      heroTitle="Flashcards"
      heroSubtitle="Recto/verso : marque chaque carte « Acquise » ou « À revoir »."
    />
  );
}

// ===========================================================================
// MODE 4 — Marathon (preset 50, sans timer)
// ===========================================================================

function MarathonMode({ categories }: { categories: CategoryRow[] }) {
  return (
    <ConfigAndPlay
      categories={categories}
      defaultCount={50}
      mode="quiz"
      heroTitle="Marathon"
      heroSubtitle="Lance 50 questions d'affilée — pas de timer, juste de l'endurance."
    />
  );
}

// ===========================================================================
// MODE 4-bis — Marathon LIBRE (50 questions face_a_face)
// ===========================================================================
// Tire UNIQUEMENT dans le pool `face_a_face` (réponses vraiment libres avec
// alias riches). Évite le bug du Marathon classique où, pour les quizz_2
// format "L'un ou l'autre", la saisie texte ne pouvait jamais matcher des
// labels génériques ("L'un", "L'autre").
//
// Pas de configurateur — on lance direct, c'est l'esprit "challenge endurance".
function MarathonLibreMode() {
  const [questions, setQuestions] = useState<RevQuestion[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await fetchQuestionsForRevision({
        categoryIds: [],
        difficulties: [],
        types: ["face_a_face"],
        count: 50,
        // J1.5 — Évite les questions déjà tirées dans les 5 dernières
        // sessions (mémoire courte terme persistée en localStorage).
        excludeQuestionIds: readRecentIds(),
      });
      if (res.status === "error") {
        setError(res.message);
      } else if (res.questions.length === 0) {
        setError(
          "Aucune question à réponse libre disponible. Vérifie que des questions de type `face_a_face` existent en base.",
        );
      } else {
        pushRecentIds(res.questions.map((q) => q.questionId));
        setQuestions(res.questions);
      }
    });
  }

  if (questions) {
    return (
      <QuizPlayer
        questions={questions}
        trackWrong
        isReshuffling={isPending}
        onReshuffle={() => {
          // Re-tirage à la Q1 : on relance fetchQuestionsForRevision avec
          // les mêmes paramètres. Comme le pool éligible exclut désormais
          // les IDs récents (pushRecentIds vient d'être appelé au tirage
          // précédent), on évite naturellement de retomber sur la liste
          // qu'on vient de jeter.
          start();
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-sky/15 text-sky">
        <Timer className="h-10 w-10" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-bold uppercase tracking-widest text-sky">
          Marathon — Réponses libres
        </p>
        <h1 className="font-display text-3xl font-extrabold text-foreground">
          50 questions à taper au clavier
        </h1>
        <p className="max-w-md text-foreground/70">
          Pas de boutons, pas de QCM. Tape ta réponse en toutes lettres :
          le système accepte les variantes courantes (alias) et tolère les
          fautes de frappe sur les noms longs. <strong>Strict</strong> en
          revanche pour les dates et années.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-buzz/40 bg-buzz/10 px-4 py-2 text-sm text-buzz"
        >
          {error}
        </p>
      )}
      <Button
        variant="gold"
        size="lg"
        onClick={start}
        disabled={isPending}
        className="text-lg"
      >
        <Timer className="h-5 w-5" aria-hidden="true" />
        {isPending ? "Préparation…" : "Commencer le marathon"}
      </Button>
    </main>
  );
}

// ===========================================================================
// Configurateur réutilisé par Apprendre / Flashcards / Marathon
// ===========================================================================

function ConfigAndPlay({
  categories,
  defaultCount,
  mode,
  heroTitle,
  heroSubtitle,
}: {
  categories: CategoryRow[];
  defaultCount: number;
  mode: "quiz" | "flashcards";
  heroTitle: string;
  heroSubtitle: string;
}) {
  const [count, setCount] = useState(defaultCount);
  const [selectedCats, setSelectedCats] = useState<number[]>([]);
  const [selectedDiffs, setSelectedDiffs] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    "quizz_2",
    "quizz_4",
  ]);
  const [questions, setQuestions] = useState<RevQuestion[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await fetchQuestionsForRevision({
        categoryIds: selectedCats,
        difficulties: selectedDiffs,
        types: selectedTypes,
        count,
        // J1.5 — Anti-répétition courte terme : on exclut les IDs vus
        // dans les 5 dernières sessions Marathon/Apprendre. Si après
        // exclusion le pool est trop petit, le serveur retombe sur le
        // pool complet (cf. fetchQuestionsForRevision).
        excludeQuestionIds: readRecentIds(),
      });
      if (res.status === "error") {
        setError(res.message);
      } else if (res.questions.length === 0) {
        setError("Aucune question ne correspond à ces filtres.");
      } else {
        pushRecentIds(res.questions.map((q) => q.questionId));
        setQuestions(res.questions);
      }
    });
  }

  if (questions) {
    return mode === "flashcards" ? (
      <FlashcardPlayer questions={questions} />
    ) : (
      <QuizPlayer questions={questions} trackWrong />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-4 sm:p-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
          {heroTitle}
        </p>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-foreground">
          {heroSubtitle}
        </h1>
      </header>

      <Section title="Nombre de questions">
        <div className="flex items-center gap-3">
          {[5, 10, 20, 50, 100].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-bold",
                count === n
                  ? "border-gold bg-gold/15 text-foreground"
                  : "border-border bg-card text-foreground/70 hover:border-gold/50",
              )}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
            }
            className="h-9 w-20 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:border-gold focus:outline-none"
          />
        </div>
      </Section>

      <Section title="Catégories" desc="Aucune sélection = toutes.">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const sel = selectedCats.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  setSelectedCats((prev) =>
                    sel ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                  )
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-bold transition-colors",
                  sel
                    ? "border-gold bg-gold/15 text-foreground"
                    : "border-border bg-card text-foreground/70 hover:border-gold/50",
                )}
                style={
                  sel
                    ? { borderColor: c.couleur ?? "#F5B700", backgroundColor: (c.couleur ?? "#F5B700") + "26" }
                    : undefined
                }
              >
                {c.nom}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Difficulté" desc="Aucune sélection = toutes.">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((d) => {
            const sel = selectedDiffs.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  setSelectedDiffs((prev) =>
                    sel ? prev.filter((x) => x !== d) : [...prev, d],
                  )
                }
                className={cn(
                  "h-9 w-9 rounded-md border text-sm font-bold",
                  sel
                    ? "border-gold bg-gold/15 text-foreground"
                    : "border-border bg-card text-foreground/70 hover:border-gold/50",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Types de questions">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => {
            const sel = selectedTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setSelectedTypes((prev) =>
                    sel ? prev.filter((x) => x !== t) : [...prev, t],
                  )
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-bold transition-colors",
                  sel
                    ? "border-sky bg-sky/15 text-foreground"
                    : "border-border bg-card text-foreground/70 hover:border-sky/50",
                )}
              >
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-foreground/50">
          Note : seuls les types « 2 réponses » et « 4 propositions » sont
          interactifs côté quiz. Les autres seront en mode lecture.
        </p>
      </Section>

      {error && (
        <p className="rounded-md border border-buzz/40 bg-buzz/10 px-3 py-2 text-sm text-buzz">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          variant="gold"
          size="lg"
          onClick={start}
          disabled={isPending || selectedTypes.length === 0}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" fill="currentColor" />
          )}
          {isPending ? "Chargement…" : "Lancer"}
        </Button>
      </div>
    </main>
  );
}

// ===========================================================================
// MODE 5 — Défi du jour
// ===========================================================================

/**
 * Formate une date ISO (YYYY-MM-DD) en français lisible avec jour de
 * la semaine. Ex : "lundi 27 avril 2026".
 *
 * E3.2 — Remplace le format ISO peu lisible affiché auparavant.
 */
function formatDefiDate(isoDate: string | null): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function DefiMode() {
  const [questions, setQuestions] = useState<RevQuestion[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);

  function load() {
    setError(null);
    startTransition(async () => {
      const res = await fetchDailyChallenge();
      if (res.status === "error") setError(res.message);
      else {
        setQuestions(res.questions);
        setDate(res.date);
      }
    });
  }

  if (started && questions) {
    return <QuizPlayer questions={questions} trackWrong />;
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-5 p-6 text-center sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative flex w-full flex-col items-center gap-4 overflow-hidden rounded-3xl border border-gold/30 bg-gradient-to-br from-gold-pale via-cream to-sky-pale p-8 shadow-[0_0_64px_rgba(245,183,0,0.25)]"
      >
        {/* Halo décoratif */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gold/40 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-sky/30 blur-2xl"
        />

        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gold/30 text-gold-warm shadow-[0_0_48px_rgba(245,183,0,0.45)]"
        >
          <Calendar className="h-12 w-12" aria-hidden="true" />
        </motion.div>
        <header className="relative">
          <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
            Défi du jour
          </p>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-foreground">
            5 questions, identiques pour tous
          </h1>
          {date && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1 text-sm font-bold capitalize text-foreground">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {formatDefiDate(date)}
            </p>
          )}
          <p className="mt-3 text-sm text-foreground/70">
            Le tirage change à minuit. Reviens demain pour de nouvelles.
          </p>
        </header>
      </motion.div>

      {!questions ? (
        <Button variant="gold" size="lg" onClick={load} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" fill="currentColor" />
          )}
          {isPending ? "Chargement…" : "Charger le défi"}
        </Button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-foreground/70">
            <strong className="text-foreground">{questions.length}</strong>{" "}
            question{questions.length > 1 ? "s" : ""} prête
            {questions.length > 1 ? "s" : ""}.
          </p>
          <Button
            variant="gold"
            size="lg"
            onClick={() => setStarted(true)}
          >
            <Play className="h-4 w-4" aria-hidden="true" fill="currentColor" />
            Commencer
          </Button>
        </div>
      )}
      {error && (
        <p className="rounded-md border border-buzz/40 bg-buzz/10 px-3 py-2 text-sm text-buzz">
          {error}
        </p>
      )}
    </main>
  );
}

// ===========================================================================
// MODE 6 — Fiche de révision (lecture par catégorie)
// ===========================================================================

function FicheMode({ categories }: { categories: CategoryRow[] }) {
  const [selected, setSelected] = useState<CategoryRow | null>(null);
  const [questions, setQuestions] = useState<RevQuestion[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(c: CategoryRow) {
    setSelected(c);
    setError(null);
    setQuestions(null);
    startTransition(async () => {
      const res = await fetchFiche(c.id, 50);
      if (res.status === "error") setError(res.message);
      else setQuestions(res.questions);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-4 sm:p-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-sky">
          Fiche de révision
        </p>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-foreground">
          {selected ? `Fiche : ${selected.nom}` : "Choisis une catégorie"}
        </h1>
      </header>

      {!selected && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="rounded-xl border border-border bg-card p-3 text-left hover:border-gold/50 hover:bg-gold/5"
            >
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-color"
                style={{ backgroundColor: c.couleur ?? "#F5B700" }}
              >
                {c.nom}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuestions(null);
            }}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/70 hover:border-gold/50"
          >
            Changer de catégorie
          </button>
        </div>
      )}

      {isPending && <Loader2 className="h-6 w-6 animate-spin text-gold-warm" aria-hidden="true" />}
      {error && (
        <p className="rounded-md border border-buzz/40 bg-buzz/10 px-3 py-2 text-sm text-buzz">
          {error}
        </p>
      )}

      {questions && (
        <ul className="flex flex-col gap-3">
          {questions.map((q) => {
            const correct =
              q.bonneReponse || q.reponses.find((r) => r.correct)?.text || "—";
            return (
              <li
                key={q.questionId}
                className="rounded-xl border border-border bg-card p-4 glow-card"
              >
                <p className="text-xs font-bold uppercase tracking-wider text-foreground/50">
                  Difficulté {q.difficulte}
                </p>
                <p className="mt-1 font-display text-lg font-bold text-foreground">
                  {q.enonce}
                </p>
                <p className="mt-2 text-life-green">
                  → <strong>{correct}</strong>
                </p>
                {q.explication && (
                  <p className="mt-1 text-sm text-foreground/70">
                    {q.explication}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

// ===========================================================================
// MODE 7 — Favoris
// ===========================================================================

function FavorisMode() {
  const [questions, setQuestions] = useState<RevQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);

  function load() {
    setError(null);
    startTransition(async () => {
      const res = await fetchFavorites();
      if (res.status === "error") setError(res.message);
      else setQuestions(res.questions);
    });
  }

  if (started && questions) {
    // I1.5 — Toutes les questions chargées via fetchFavorites() sont par
    // définition favorites → toutes les étoiles s'affichent remplies.
    const favoriteIds = new Set(questions.map((q) => q.questionId));
    return (
      <QuizPlayer questions={questions} trackWrong favoriteIds={favoriteIds} />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gold/20 text-gold-warm">
        <Star className="h-12 w-12" aria-hidden="true" fill="currentColor" />
      </div>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-gold-warm">
          Favoris
        </p>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-foreground">
          Tes questions étoilées
        </h1>
        <p className="mt-2 text-foreground/70">
          Étoile une question pendant tes révisions, puis retrouve-les ici
          pour les rejouer.
        </p>
      </header>

      {!questions ? (
        <Button variant="gold" size="lg" onClick={load} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" fill="currentColor" />
          )}
          {isPending ? "Chargement…" : "Charger mes favoris"}
        </Button>
      ) : questions.length === 0 ? (
        <p className="text-foreground/70">
          Aucune question favorite pour l&apos;instant. Clique l&apos;étoile
          d&apos;une question pendant une session de révision.
        </p>
      ) : (
        <Button
          variant="gold"
          size="lg"
          onClick={() => setStarted(true)}
        >
          <Play className="h-4 w-4" aria-hidden="true" fill="currentColor" />
          Lancer ({questions.length})
        </Button>
      )}
      {error && (
        <p className="rounded-md border border-buzz/40 bg-buzz/10 px-3 py-2 text-sm text-buzz">
          {error}
        </p>
      )}
    </main>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-foreground/70">
          {title}
        </h2>
        {desc && <p className="text-xs text-foreground/50">{desc}</p>}
      </div>
      {children}
    </section>
  );
}
