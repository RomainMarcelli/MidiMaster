import { describe, expect, it } from "vitest";
import { QUESTION_TYPES, questionSchema } from "./question";

function baseInput<T extends Record<string, unknown>>(overrides: T) {
  return {
    type: "quizz_2",
    category_slug: "histoire",
    difficulte: 2,
    enonce: "Question de test ?",
    reponses: [
      { text: "A", correct: true },
      { text: "B", correct: false },
    ],
    ...overrides,
  };
}

describe("QUESTION_TYPES", () => {
  it("contient les 6 types attendus", () => {
    expect([...QUESTION_TYPES].sort()).toEqual([
      "coup_maitre",
      "coup_par_coup",
      "etoile",
      "face_a_face",
      "quizz_2",
      "quizz_4",
    ]);
  });
});

describe("questionSchema — quizz_2", () => {
  it("accepte une question valide", () => {
    const input = baseInput({});
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette 1 seule réponse", () => {
    const input = baseInput({
      reponses: [{ text: "A", correct: true }],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette 2 réponses correctes", () => {
    const input = baseInput({
      reponses: [
        { text: "A", correct: true },
        { text: "B", correct: true },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette 0 réponse correcte", () => {
    const input = baseInput({
      reponses: [
        { text: "A", correct: false },
        { text: "B", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});

describe("questionSchema — quizz_4", () => {
  it("accepte 4 réponses dont 1 correcte", () => {
    const input = baseInput({
      type: "quizz_4",
      reponses: [
        { text: "A", correct: false },
        { text: "B", correct: true },
        { text: "C", correct: false },
        { text: "D", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette 3 réponses", () => {
    const input = baseInput({
      type: "quizz_4",
      reponses: [
        { text: "A", correct: true },
        { text: "B", correct: false },
        { text: "C", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});

describe("questionSchema — etoile", () => {
  it("accepte avec bonne_reponse + indices", () => {
    const input = baseInput({
      type: "etoile",
      reponses: [],
      bonne_reponse: "Napoléon",
      alias: ["Bonaparte"],
      indices: ["I1", "I2", "I3", "I4", "I5"],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette si bonne_reponse manquante", () => {
    const input = baseInput({
      type: "etoile",
      reponses: [],
      indices: ["I1"],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette si indices manquants", () => {
    const input = baseInput({
      type: "etoile",
      reponses: [],
      bonne_reponse: "Napoléon",
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});

describe("questionSchema — face_a_face", () => {
  it("accepte avec bonne_reponse (pas de reponses array)", () => {
    const input = baseInput({
      type: "face_a_face",
      reponses: [],
      bonne_reponse: "Paris",
      alias: ["Lutèce"],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette si bonne_reponse vide", () => {
    const input = baseInput({
      type: "face_a_face",
      reponses: [],
      bonne_reponse: "",
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette si bonne_reponse manquante", () => {
    const input = baseInput({
      type: "face_a_face",
      reponses: [],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});

describe("questionSchema — coup_par_coup", () => {
  const valid7 = [
    { text: "V1", correct: true },
    { text: "V2", correct: true },
    { text: "V3", correct: true },
    { text: "V4", correct: true },
    { text: "V5", correct: true },
    { text: "V6", correct: true },
    { text: "Intrus", correct: false },
  ];

  it("accepte 7 propositions (6 + 1 intrus)", () => {
    const input = baseInput({
      type: "coup_par_coup",
      reponses: valid7,
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette 6 propositions", () => {
    const input = baseInput({
      type: "coup_par_coup",
      reponses: valid7.slice(0, 6),
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette 7 propositions dont 5 valides seulement", () => {
    const bad = valid7.map((p, i) =>
      i === 5 ? { ...p, correct: false } : p,
    );
    const input = baseInput({
      type: "coup_par_coup",
      reponses: bad,
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette 7 propositions toutes valides (pas d'intrus)", () => {
    const bad = valid7.map((p) => ({ ...p, correct: true }));
    const input = baseInput({
      type: "coup_par_coup",
      reponses: bad,
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});

describe("questionSchema — format (Coup d'Envoi)", () => {
  it("accepte format vrai_faux avec réponses Vrai/Faux", () => {
    const input = baseInput({
      type: "quizz_2",
      format: "vrai_faux",
      reponses: [
        { text: "Vrai", correct: true },
        { text: "Faux", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette format vrai_faux avec réponses qui ne sont pas Vrai/Faux", () => {
    const input = baseInput({
      type: "quizz_2",
      format: "vrai_faux",
      reponses: [
        { text: "Oui", correct: true },
        { text: "Non", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("accepte format plus_moins avec réponses Plus/Moins", () => {
    const input = baseInput({
      type: "quizz_2",
      format: "plus_moins",
      reponses: [
        { text: "Plus", correct: true },
        { text: "Moins", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette format plus_moins avec réponses qui ne sont pas Plus/Moins", () => {
    const input = baseInput({
      type: "quizz_2",
      format: "plus_moins",
      reponses: [
        { text: "Oui", correct: true },
        { text: "Non", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("accepte format 'ou' avec n'importe quelles réponses", () => {
    const input = baseInput({
      type: "quizz_2",
      format: "ou",
      reponses: [
        { text: "Hugo", correct: true },
        { text: "Zola", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("accepte format 'choix_2' avec n'importe quelles réponses (générique)", () => {
    const input = baseInput({
      type: "quizz_2",
      format: "choix_2",
      reponses: [
        { text: "Mer Méditerranée", correct: true },
        { text: "Mer Baltique", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });

  it("rejette format 'choix_2' sur un type autre que quizz_2", () => {
    const input = baseInput({
      type: "quizz_4",
      format: "choix_2",
      reponses: [
        { text: "A", correct: true },
        { text: "B", correct: false },
        { text: "C", correct: false },
        { text: "D", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette format défini sur un type autre que quizz_2", () => {
    const input = baseInput({
      type: "quizz_4",
      format: "vrai_faux",
      reponses: [
        { text: "A", correct: true },
        { text: "B", correct: false },
        { text: "C", correct: false },
        { text: "D", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("accepte quizz_2 sans format (legacy)", () => {
    const input = baseInput({
      type: "quizz_2",
      reponses: [
        { text: "A", correct: true },
        { text: "B", correct: false },
      ],
    });
    expect(questionSchema.safeParse(input).success).toBe(true);
  });
});

describe("questionSchema — champs communs", () => {
  it("rejette un énoncé trop court", () => {
    const input = baseInput({ enonce: "a" });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette une difficulté hors bornes", () => {
    const input = baseInput({ difficulte: 6 });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette une difficulté non entière", () => {
    const input = baseInput({ difficulte: 2.5 });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });

  it("rejette une category_slug vide", () => {
    const input = baseInput({ category_slug: "" });
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});
