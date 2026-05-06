import { z } from "zod";

/**
 * Schéma de validation des questions Midi Master.
 * Partagé entre :
 *  - le script de seed (src/scripts/seed.ts)
 *  - l'import JSON admin (/admin/questions/import)
 *  - les formulaires new / edit
 *
 * Le champ `category_slug` / `subcategory_slug` est résolu côté backend
 * en category_id / subcategory_id avant INSERT.
 */

export const QUESTION_TYPES = [
  "quizz_2",
  "quizz_4",
  "etoile",
  "face_a_face",
  "coup_maitre",
  "coup_par_coup",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_FORMATS = [
  "vrai_faux",
  "ou",
  "plus_moins",
  "choix_2",
] as const;

export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

const reponseSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
});

const baseFields = {
  type: z.enum(QUESTION_TYPES),
  category_slug: z.string().min(1),
  subcategory_slug: z.string().min(1).optional(),
  difficulte: z.number().int().min(1).max(5).default(2),
  enonce: z.string().min(3),
  reponses: z.array(reponseSchema).default([]),
  bonne_reponse: z.string().optional(),
  alias: z.array(z.string()).optional(),
  indices: z.array(z.string()).optional(),
  image_url: z.string().url().optional(),
  explication: z.string().optional(),
  format: z.enum(QUESTION_FORMATS).optional(),
};

/**
 * Schéma global avec validations conditionnelles par type.
 */
export const questionSchema = z
  .object(baseFields)
  .superRefine((q, ctx) => {
    const countReponses = q.reponses.length;
    const countCorrect = q.reponses.filter((r) => r.correct).length;

    // `format` est réservé à quizz_2.
    if (q.format && q.type !== "quizz_2") {
      ctx.addIssue({
        code: "custom",
        path: ["format"],
        message: "`format` est uniquement autorisé pour quizz_2.",
      });
    }

    switch (q.type) {
      case "quizz_2":
        if (countReponses !== 2) {
          ctx.addIssue({
            code: "custom",
            path: ["reponses"],
            message: "quizz_2 : exactement 2 réponses requises.",
          });
        }
        if (countCorrect !== 1) {
          ctx.addIssue({
            code: "custom",
            path: ["reponses"],
            message: "quizz_2 : exactement 1 réponse correcte.",
          });
        }
        // format est optionnel pour quizz_2, mais s'il est défini il doit
        // correspondre aux réponses attendues :
        if (q.format === "vrai_faux") {
          const texts = q.reponses.map((r) => r.text.toLowerCase().trim());
          if (!texts.includes("vrai") || !texts.includes("faux")) {
            ctx.addIssue({
              code: "custom",
              path: ["reponses"],
              message:
                "format vrai_faux : les réponses doivent être 'Vrai' et 'Faux'.",
            });
          }
        }
        if (q.format === "plus_moins") {
          const texts = q.reponses.map((r) => r.text.toLowerCase().trim());
          if (!texts.includes("plus") || !texts.includes("moins")) {
            ctx.addIssue({
              code: "custom",
              path: ["reponses"],
              message:
                "format plus_moins : les réponses doivent être 'Plus' et 'Moins'.",
            });
          }
        }
        break;

      case "quizz_4":
        if (countReponses !== 4) {
          ctx.addIssue({
            code: "custom",
            path: ["reponses"],
            message: "quizz_4 : exactement 4 réponses requises.",
          });
        }
        if (countCorrect !== 1) {
          ctx.addIssue({
            code: "custom",
            path: ["reponses"],
            message: "quizz_4 : exactement 1 réponse correcte.",
          });
        }
        break;

      case "etoile":
      case "coup_maitre":
        if (!q.bonne_reponse || q.bonne_reponse.trim() === "") {
          ctx.addIssue({
            code: "custom",
            path: ["bonne_reponse"],
            message: `${q.type} : bonne_reponse requise.`,
          });
        }
        if (!q.indices || q.indices.length < 1) {
          ctx.addIssue({
            code: "custom",
            path: ["indices"],
            message: `${q.type} : au moins 1 indice requis (3 recommandés pour coup_maitre, 5 pour etoile).`,
          });
        }
        break;

      case "face_a_face":
        if (!q.bonne_reponse || q.bonne_reponse.trim() === "") {
          ctx.addIssue({
            code: "custom",
            path: ["bonne_reponse"],
            message: "face_a_face : bonne_reponse requise.",
          });
        }
        break;

      case "coup_par_coup":
        if (countReponses !== 7) {
          ctx.addIssue({
            code: "custom",
            path: ["reponses"],
            message:
              "coup_par_coup : exactement 7 propositions requises (6 liées + 1 intrus).",
          });
        }
        if (countCorrect !== 6) {
          ctx.addIssue({
            code: "custom",
            path: ["reponses"],
            message:
              "coup_par_coup : exactement 6 propositions correct:true (liées) et 1 correct:false (intrus).",
          });
        }
        break;
    }
  });

export type QuestionInput = z.infer<typeof questionSchema>;

/**
 * Schéma d'un import de masse (tableau).
 */
export const questionsBulkSchema = z.array(questionSchema);
