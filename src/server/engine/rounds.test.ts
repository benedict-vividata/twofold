import { describe, expect, it } from "vitest";
import { DEGRADATIONS } from "./catalogue.js";
import { degradationMenu, pickPairKind } from "./rounds.js";

describe("pickPairKind", () => {
  it("maps the roll onto the weights in order", () => {
    const mix = { degraded: 70, tradeoff: 20, bothFlawed: 10, control: 0 };
    expect(pickPairKind(mix, () => 0)).toBe("degraded");
    expect(pickPairKind(mix, () => 69)).toBe("degraded");
    expect(pickPairKind(mix, () => 70)).toBe("tradeoff");
    expect(pickPairKind(mix, () => 89)).toBe("tradeoff");
    expect(pickPairKind(mix, () => 90)).toBe("both-flawed");
  });

  it("never picks a kind with zero weight", () => {
    const mix = { degraded: 0, tradeoff: 0, bothFlawed: 0, control: 5 };
    for (let roll = 0; roll < 5; roll += 1) expect(pickPairKind(mix, () => roll)).toBe("control");
  });
});

describe("degradationMenu", () => {
  it("only offers enabled flaws and pushes recent ones to the back", () => {
    const enabled = ["duplicated-logic", "noise", "god-function"];
    const menu = degradationMenu(enabled, ["noise"], () => 0);
    expect(menu.map((entry) => entry.id).sort()).toEqual([...enabled].sort());
    expect(menu.at(-1)?.id).toBe("noise");
  });

  it("falls back to the whole catalogue if nothing known is enabled", () => {
    expect(degradationMenu(["nope"], [], () => 0)).toHaveLength(DEGRADATIONS.length);
  });
});
