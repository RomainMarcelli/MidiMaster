import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnswerButtons } from "./AnswerButtons";

/**
 * Vague T (#7) — Tests sentinelle React Testing Library + jsdom.
 *
 * On teste le contrat public du composant : props → DOM observable. Les
 * animations Framer Motion sont mockées par `setup-rtl.ts` (motion.button
 * → button natif), donc seul le rendu structurel et l'interactivité
 * comptent ici.
 */

const choicesAB = [
  { idx: 0, text: "Paris" },
  { idx: 1, text: "Lyon" },
];

const choicesABCD = [
  { idx: 0, text: "Athènes" },
  { idx: 1, text: "Berlin" },
  { idx: 2, text: "Caïro" },
  { idx: 3, text: "Doha" },
];

describe("AnswerButtons", () => {
  it("rend 2 boutons pour quizz_2", () => {
    render(
      <AnswerButtons
        choices={choicesAB}
        showText
        enabled
        onAnswer={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("rend 4 boutons pour quizz_4", () => {
    render(
      <AnswerButtons
        choices={choicesABCD}
        showText
        enabled
        onAnswer={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("affiche le texte des choix en mode showText=true", () => {
    render(
      <AnswerButtons
        choices={choicesAB}
        showText
        enabled
        onAnswer={() => {}}
      />,
    );
    expect(screen.getByText("Paris")).toBeInTheDocument();
    expect(screen.getByText("Lyon")).toBeInTheDocument();
  });

  it("masque le texte des choix en mode showText=false (mode light)", () => {
    render(
      <AnswerButtons
        choices={choicesAB}
        showText={false}
        enabled
        onAnswer={() => {}}
      />,
    );
    expect(screen.queryByText("Paris")).not.toBeInTheDocument();
    expect(screen.queryByText("Lyon")).not.toBeInTheDocument();
  });

  it("appelle onAnswer avec l'idx du choix cliqué", () => {
    const onAnswer = vi.fn();
    render(
      <AnswerButtons
        choices={choicesABCD}
        showText
        enabled
        onAnswer={onAnswer}
      />,
    );
    // aria-label: "Réponse C : Caïro"
    fireEvent.click(screen.getByLabelText("Réponse C : Caïro"));
    expect(onAnswer).toHaveBeenCalledWith(2);
  });

  it("désactive les boutons quand enabled=false", () => {
    render(
      <AnswerButtons
        choices={choicesAB}
        showText
        enabled={false}
        onAnswer={() => {}}
      />,
    );
    for (const btn of screen.getAllByRole("button")) {
      expect(btn).toBeDisabled();
    }
  });

  it("ne déclenche pas onAnswer en cas de clic quand disabled", () => {
    const onAnswer = vi.fn();
    render(
      <AnswerButtons
        choices={choicesAB}
        showText
        enabled={false}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByLabelText("Réponse A : Paris"));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("annonce la lettre correcte (A/B/C/D) dans aria-label", () => {
    render(
      <AnswerButtons
        choices={choicesABCD}
        showText
        enabled
        onAnswer={() => {}}
      />,
    );
    expect(screen.getByLabelText("Réponse A : Athènes")).toBeInTheDocument();
    expect(screen.getByLabelText("Réponse D : Doha")).toBeInTheDocument();
  });
});
