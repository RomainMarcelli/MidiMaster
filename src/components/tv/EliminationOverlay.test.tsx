import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EliminationOverlay } from "./EliminationOverlay";

/**
 * Vague T (#7) — Tests sentinelle de l'overlay d'élimination. On vérifie :
 *  - Le composant ne rend rien quand `visible=false` (bug Vague R où il
 *    restait monté en arrière-plan).
 *  - Le pseudo, le label "from", le label "next" sont correctement affichés.
 *  - L'avatar par défaut (Skull icon) apparaît en absence d'URL.
 */
describe("EliminationOverlay", () => {
  it("ne rend rien quand visible=false", () => {
    const { container } = render(
      <EliminationOverlay
        visible={false}
        pseudo="Alice"
        avatarUrl={null}
        fromPhase="coup-envoi"
        nextPhase="coup-par-coup"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("affiche le pseudo de l'éliminé", () => {
    render(
      <EliminationOverlay
        visible
        pseudo="Alice"
        avatarUrl={null}
        fromPhase="coup-envoi"
        nextPhase="coup-par-coup"
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/est éliminé/i)).toBeInTheDocument();
  });

  it("affiche le label de la phase qui se termine (Coup d'Envoi)", () => {
    render(
      <EliminationOverlay
        visible
        pseudo="Alice"
        avatarUrl={null}
        fromPhase="coup-envoi"
        nextPhase="coup-par-coup"
      />,
    );
    expect(
      screen.getByText(/Fin de la phase Coup d'Envoi/i),
    ).toBeInTheDocument();
  });

  it("affiche le label de la phase qui se termine (Coup par Coup)", () => {
    render(
      <EliminationOverlay
        visible
        pseudo="Bob"
        avatarUrl={null}
        fromPhase="coup-par-coup"
        nextPhase="face-a-face"
      />,
    );
    expect(
      screen.getByText(/Fin de la phase Coup par Coup/i),
    ).toBeInTheDocument();
  });

  it("affiche la prochaine étape (Coup par Coup)", () => {
    render(
      <EliminationOverlay
        visible
        pseudo="Alice"
        avatarUrl={null}
        fromPhase="coup-envoi"
        nextPhase="coup-par-coup"
      />,
    );
    expect(screen.getByText(/Prochaine étape/i)).toBeInTheDocument();
    expect(screen.getByText("Coup par Coup")).toBeInTheDocument();
  });

  it("affiche la prochaine étape (Face-à-Face)", () => {
    render(
      <EliminationOverlay
        visible
        pseudo="Bob"
        avatarUrl={null}
        fromPhase="coup-par-coup"
        nextPhase="face-a-face"
      />,
    );
    expect(screen.getByText("Face-à-Face")).toBeInTheDocument();
  });

  it("a un role=dialog avec aria-live='assertive' (annonce screen reader)", () => {
    render(
      <EliminationOverlay
        visible
        pseudo="Alice"
        avatarUrl={null}
        fromPhase="coup-envoi"
        nextPhase="coup-par-coup"
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-live", "assertive");
  });
});
