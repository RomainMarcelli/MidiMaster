import { describe, expect, it } from "vitest";
import { parseQuizzAnswers, shuffle } from "./tv-actions-helpers";

describe("parseQuizzAnswers", () => {
  it("retourne null pour un payload null/undefined", () => {
    expect(parseQuizzAnswers(null)).toBeNull();
    expect(parseQuizzAnswers(undefined)).toBeNull();
  });

  it("retourne null pour un array vide", () => {
    expect(parseQuizzAnswers([])).toBeNull();
  });

  it("retourne null pour un payload non-array", () => {
    expect(parseQuizzAnswers({ wrong: "shape" })).toBeNull();
    expect(parseQuizzAnswers("not an array")).toBeNull();
  });

  it("parse 2 réponses (quizz_2) avec correctIdx=0", () => {
    const r = parseQuizzAnswers([
      { text: "Paris", correct: true },
      { text: "Lyon" },
    ]);
    expect(r).toEqual({
      choices: [
        { idx: 0, text: "Paris" },
        { idx: 1, text: "Lyon" },
      ],
      correctIdx: 0,
    });
  });

  it("parse 4 réponses (quizz_4) avec correctIdx=2", () => {
    const r = parseQuizzAnswers([
      { text: "A" },
      { text: "B" },
      { text: "C", correct: true },
      { text: "D" },
    ]);
    expect(r?.choices).toHaveLength(4);
    expect(r?.correctIdx).toBe(2);
  });

  it("retourne correctIdx=-1 si aucune réponse n'est marquée correcte", () => {
    const r = parseQuizzAnswers([{ text: "A" }, { text: "B" }]);
    expect(r?.correctIdx).toBe(-1);
  });
});

describe("shuffle", () => {
  it("retourne un array de même longueur", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toHaveLength(5);
  });

  it("ne mute pas l'array d'origine", () => {
    const arr = [1, 2, 3];
    const original = [...arr];
    shuffle(arr);
    expect(arr).toEqual(original);
  });

  it("contient les mêmes éléments (permutation)", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = shuffle(arr);
    expect(out.sort((a, b) => a - b)).toEqual(arr);
  });

  it("est déterministe avec un rng injecté", () => {
    let seed = 0;
    const rng = () => {
      seed = (seed + 0.31415926) % 1;
      return seed;
    };
    const a = shuffle([1, 2, 3, 4, 5], rng);
    seed = 0;
    const b = shuffle([1, 2, 3, 4, 5], rng);
    expect(a).toEqual(b);
  });

  it("est uniforme : chaque position reçoit chaque valeur ~équitablement", () => {
    // 1000 tirages de shuffle([0,1,2,3]) — la première position doit recevoir
    // chacune des 4 valeurs ~250 fois (±70). C'est ce que le sort biaisé
    // (`Math.random() - 0.5`) ne garantit PAS.
    const N = 4;
    const counts = Array.from({ length: N }, () => Array(N).fill(0));
    for (let i = 0; i < 1000; i++) {
      const out = shuffle([0, 1, 2, 3]);
      for (let pos = 0; pos < N; pos++) {
        counts[pos]![out[pos]!]! += 1;
      }
    }
    for (let pos = 0; pos < N; pos++) {
      for (let val = 0; val < N; val++) {
        expect(counts[pos]![val]!).toBeGreaterThan(180);
        expect(counts[pos]![val]!).toBeLessThan(320);
      }
    }
  });

  it("accepte un readonly array (signature elargie)", () => {
    const arr: readonly string[] = ["a", "b", "c"];
    const out = shuffle(arr);
    expect(out).toHaveLength(3);
  });
});
