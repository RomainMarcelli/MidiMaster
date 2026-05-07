import type { QuestionType } from "@/lib/schemas/question";

/**
 * M5.1 — Données structurées du guide de format d'import.
 * Extraites du composant `ImportFormatGuide` pour être testables
 * unitairement (cf. `import-format-examples.test.ts`).
 *
 * Pour chaque type de question, on documente : description, modes
 * concernés, champs requis/optionnels, particularités, et un exemple
 * JSON valide selon `questionsBulkSchema`.
 *
 * Quand `src/lib/schemas/question.ts` évolue, mettre à jour ces
 * exemples et le test devrait toujours passer.
 */

export interface FieldDoc {
  name: string;
  type: string;
  description?: string;
}

export interface FormatExample {
  type: QuestionType;
  label: string;
  description: string;
  modes: string[];
  requiredFields: FieldDoc[];
  optionalFields: FieldDoc[];
  particularities: string[];
  example: object;
}

export const FORMATS: FormatExample[] = [
  {
    type: "face_a_face",
    label: "face_a_face — Question ouverte (réponse libre)",
    description: "Le joueur tape sa réponse au clavier ou dicte à la voix.",
    modes: [
      "Marathon",
      "Marathon libre",
      "Refaire mes erreurs",
      "Le Coup Fatal (jeu rapide)",
    ],
    requiredFields: [
      { name: "type", type: '"face_a_face"' },
      { name: "category_slug", type: "string" },
      { name: "enonce", type: "string" },
      { name: "bonne_reponse", type: "string" },
    ],
    optionalFields: [
      { name: "alias", type: "string[]", description: "synonymes acceptés" },
      { name: "difficulte", type: "1-5", description: "défaut 2" },
      { name: "subcategory_slug", type: "string" },
      { name: "explication", type: "string" },
      { name: "image_url", type: "string (URL)" },
    ],
    particularities: [
      "`bonne_reponse` est obligatoire (sinon la question ne peut pas être validée).",
      "`reponses` doit être absent ou vide (`[]`).",
    ],
    example: {
      type: "face_a_face",
      category_slug: "geographie",
      difficulte: 2,
      enonce: "Quelle est la capitale du Portugal ?",
      bonne_reponse: "Lisbonne",
      alias: ["Lisboa"],
      explication: "Capitale et plus grande ville du Portugal.",
    },
  },
  {
    type: "quizz_4",
    label: "quizz_4 — Choix entre 4 réponses",
    description: "QCM avec 4 options dont 1 seule correcte.",
    modes: ["Marathon", "Apprendre", "Le Coup d'Envoi"],
    requiredFields: [
      { name: "type", type: '"quizz_4"' },
      { name: "category_slug", type: "string" },
      { name: "enonce", type: "string" },
      {
        name: "reponses",
        type: "{ text, correct }[]",
        description: "exactement 4 options",
      },
    ],
    optionalFields: [
      { name: "difficulte", type: "1-5" },
      { name: "subcategory_slug", type: "string" },
      { name: "explication", type: "string" },
      { name: "image_url", type: "string (URL)" },
    ],
    particularities: [
      "`reponses.length === 4` strict.",
      "Exactement 1 réponse avec `correct: true`.",
    ],
    example: {
      type: "quizz_4",
      category_slug: "histoire",
      difficulte: 3,
      enonce: "Qui a peint la Joconde ?",
      reponses: [
        { text: "Léonard de Vinci", correct: true },
        { text: "Michel-Ange", correct: false },
        { text: "Raphaël", correct: false },
        { text: "Botticelli", correct: false },
      ],
      explication: "Peinte entre 1503 et 1519.",
    },
  },
  {
    type: "quizz_2",
    label: "quizz_2 — Choix binaire (Vrai/Faux, L'un ou l'autre, Plus/Moins, Choix 2)",
    description:
      "QCM à 2 options. Optionnel : préciser le `format` pour activer le mode Vrai/Faux, Plus/Moins, L'un ou l'autre ou un choix binaire générique (`choix_2`).",
    modes: ["Le Coup d'Envoi", "Marathon"],
    requiredFields: [
      { name: "type", type: '"quizz_2"' },
      { name: "category_slug", type: "string" },
      { name: "enonce", type: "string" },
      {
        name: "reponses",
        type: "{ text, correct }[]",
        description: "exactement 2 options",
      },
    ],
    optionalFields: [
      {
        name: "format",
        type: '"vrai_faux" | "ou" | "plus_moins" | "choix_2"',
        description:
          "active un rendu spécial (boutons Vrai/Faux, etc.). `choix_2` = 2 choix génériques sans contrainte de libellé.",
      },
      { name: "difficulte", type: "1-5" },
      { name: "explication", type: "string" },
    ],
    particularities: [
      "`reponses.length === 2` strict.",
      "Exactement 1 réponse avec `correct: true`.",
      'Si `format: "vrai_faux"` → les réponses doivent être "Vrai" et "Faux".',
      'Si `format: "plus_moins"` → les réponses doivent être "Plus" et "Moins".',
      'Si `format: "choix_2"` → aucune contrainte sur les libellés des réponses (choix binaire générique).',
    ],
    example: {
      type: "quizz_2",
      category_slug: "histoire",
      format: "vrai_faux",
      difficulte: 1,
      enonce: "Napoléon est mort sur l'île de Sainte-Hélène.",
      reponses: [
        { text: "Vrai", correct: true },
        { text: "Faux", correct: false },
      ],
      explication: "Napoléon est mort à Sainte-Hélène le 5 mai 1821.",
    },
  },
  {
    type: "coup_par_coup",
    label: "coup_par_coup — 7 propositions, 6 liées + 1 intrus",
    description:
      "Le joueur doit identifier le seul élément qui ne fait pas partie de la liste.",
    modes: ["Le Coup par Coup (Jeu 2)"],
    requiredFields: [
      { name: "type", type: '"coup_par_coup"' },
      { name: "category_slug", type: "string" },
      { name: "enonce", type: "string", description: "thème commun" },
      {
        name: "reponses",
        type: "{ text, correct }[]",
        description: "exactement 7 propositions",
      },
    ],
    optionalFields: [
      { name: "difficulte", type: "1-5" },
      { name: "explication", type: "string" },
    ],
    particularities: [
      "`reponses.length === 7` strict.",
      "6 propositions avec `correct: true` (liées au thème) + 1 avec `correct: false` (l'intrus à éviter).",
      "L'`enonce` indique le thème : par exemple « Pays d'Europe » et 6 pays + 1 pays asiatique.",
    ],
    example: {
      type: "coup_par_coup",
      category_slug: "geographie",
      difficulte: 2,
      enonce: "Pays d'Europe",
      reponses: [
        { text: "France", correct: true },
        { text: "Espagne", correct: true },
        { text: "Italie", correct: true },
        { text: "Portugal", correct: true },
        { text: "Allemagne", correct: true },
        { text: "Belgique", correct: true },
        { text: "Japon", correct: false },
      ],
      explication: "Le Japon est un pays d'Asie de l'Est.",
    },
  },
  {
    type: "etoile",
    label: "etoile — Étoile mystérieuse (Qui suis-je ?)",
    description:
      "Devine la célébrité ou l'élément à partir d'indices progressifs.",
    modes: ["Étoile Mystérieuse"],
    requiredFields: [
      { name: "type", type: '"etoile"' },
      { name: "category_slug", type: "string" },
      {
        name: "enonce",
        type: "string",
        description: 'généralement "Qui suis-je ?"',
      },
      { name: "bonne_reponse", type: "string" },
      {
        name: "indices",
        type: "string[]",
        description: "au moins 1, idéalement 5 (du plus dur au plus facile)",
      },
    ],
    optionalFields: [
      { name: "alias", type: "string[]" },
      { name: "difficulte", type: "1-5" },
      { name: "explication", type: "string" },
      { name: "image_url", type: "string (URL)" },
    ],
    particularities: [
      "`bonne_reponse` requise.",
      "`indices` doit avoir au moins 1 entrée (5 recommandés pour Étoile).",
      "Plus le joueur révèle d'indices, moins il marque de points.",
    ],
    example: {
      type: "etoile",
      category_slug: "art",
      difficulte: 3,
      enonce: "Qui suis-je ?",
      bonne_reponse: "Picasso",
      alias: ["Pablo Picasso"],
      indices: [
        "Né en Espagne en 1881",
        "Cubiste",
        "A peint Les Demoiselles d'Avignon",
        "Guernica est l'une de mes œuvres",
        "Mon prénom est Pablo",
      ],
      explication: "Pablo Picasso, peintre espagnol (1881-1973).",
    },
  },
];
