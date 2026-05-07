import { describe, expect, it } from "vitest";
import {
  lifeBorderClass,
  lifeShadowClass,
  shouldFlashOnLifeChange,
} from "./life-card-helpers";

describe("shouldFlashOnLifeChange", () => {
  it("flash sur green → orange (1ère erreur)", () => {
    expect(shouldFlashOnLifeChange("green", "orange")).toBe(true);
  });

  it("flash sur green → red (cas rare : double erreur direct)", () => {
    expect(shouldFlashOnLifeChange("green", "red")).toBe(true);
  });

  it("flash sur orange → red (2e erreur)", () => {
    expect(shouldFlashOnLifeChange("orange", "red")).toBe(true);
  });

  it("pas de flash sur statut inchangé", () => {
    expect(shouldFlashOnLifeChange("green", "green")).toBe(false);
    expect(shouldFlashOnLifeChange("orange", "orange")).toBe(false);
    expect(shouldFlashOnLifeChange("red", "red")).toBe(false);
  });

  it("pas de flash sur remontée (orange → green) — impossible en jeu mais safe", () => {
    expect(shouldFlashOnLifeChange("orange", "green")).toBe(false);
    expect(shouldFlashOnLifeChange("red", "orange")).toBe(false);
    expect(shouldFlashOnLifeChange("red", "green")).toBe(false);
  });
});

describe("lifeBorderClass", () => {
  it("retourne le pattern éliminé en priorité", () => {
    const cls = lifeBorderClass("green", true);
    expect(cls).toContain("border-buzz/30");
    expect(cls).toContain("bg-card/30");
  });

  it("vert : border life-green + bg pastel", () => {
    const cls = lifeBorderClass("green", false);
    expect(cls).toContain("border-life-green");
    expect(cls).toContain("bg-life-green/5");
  });

  it("orange : border life-yellow + bg orangé", () => {
    const cls = lifeBorderClass("orange", false);
    expect(cls).toContain("border-life-yellow");
  });

  it("rouge : border buzz + bg rouge pâle", () => {
    const cls = lifeBorderClass("red", false);
    expect(cls).toContain("border-buzz");
    expect(cls).toContain("bg-buzz/10");
  });
});

describe("lifeShadowClass", () => {
  it("vide si éliminé (pas de glow)", () => {
    expect(lifeShadowClass("green", true)).toBe("");
    expect(lifeShadowClass("red", true)).toBe("");
  });

  it("glow rouge plus intense que vert/orange (rouge = drama)", () => {
    const green = lifeShadowClass("green", false);
    const red = lifeShadowClass("red", false);
    // les opacités sont 0.25 (vert) vs 0.4 (rouge)
    expect(green).toContain("0.25");
    expect(red).toContain("0.4");
  });

  it("3 statuts retournent des couleurs distinctes", () => {
    const greenShadow = lifeShadowClass("green", false);
    const orangeShadow = lifeShadowClass("orange", false);
    const redShadow = lifeShadowClass("red", false);
    expect(new Set([greenShadow, orangeShadow, redShadow]).size).toBe(3);
  });
});
