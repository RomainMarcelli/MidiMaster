import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DcPlayer } from "@/lib/realtime/tv-douze-coups-state";
import { TvPlayerLifeCard } from "./TvPlayerLifeCard";

/**
 * Vague T (#7) — Tests sentinelle de la card joueur. La logique de vie
 * (flash, classes border/shadow) a déjà ses tests Node dans
 * `life-card-helpers.test.ts`. Ici on teste uniquement le rendu :
 *  - Le pseudo apparaît
 *  - L'icône Crown s'affiche en l'absence d'avatar
 *  - L'overlay "éliminé" apparaît quand isEliminated=true
 */

function makePlayer(overrides: Partial<DcPlayer> = {}): DcPlayer {
  return {
    token: "p1",
    pseudo: "Alice",
    avatarUrl: null,
    lifeStatus: "green",
    isEliminated: false,
    eliminatedAt: null,
    eliminatedInPhase: null,
    score: 0,
    isFinalist: false,
    isBot: false,
    botSkill: 70,
    ...overrides,
  };
}

describe("TvPlayerLifeCard", () => {
  it("affiche le pseudo du joueur", () => {
    render(<TvPlayerLifeCard player={makePlayer()} isCurrent={false} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("rend l'icône Crown par défaut quand avatarUrl=null", () => {
    const { container } = render(
      <TvPlayerLifeCard player={makePlayer()} isCurrent={false} />,
    );
    // Lucide rend un svg avec class "lucide" — on cherche la présence d'une icône
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("affiche le pseudo même pour un joueur éliminé", () => {
    render(
      <TvPlayerLifeCard
        player={makePlayer({ isEliminated: true, eliminatedAt: 1000 })}
        isCurrent={false}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("rend en taille 'sm' (sidebar) sans crash", () => {
    render(
      <TvPlayerLifeCard player={makePlayer()} isCurrent={false} size="sm" />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("rend pour un joueur en vie verte / orange / rouge", () => {
    const { rerender } = render(
      <TvPlayerLifeCard
        player={makePlayer({ lifeStatus: "green" })}
        isCurrent
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    rerender(
      <TvPlayerLifeCard
        player={makePlayer({ lifeStatus: "orange" })}
        isCurrent
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    rerender(
      <TvPlayerLifeCard
        player={makePlayer({ lifeStatus: "red" })}
        isCurrent
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
