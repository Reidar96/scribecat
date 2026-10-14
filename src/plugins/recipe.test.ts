import { describe, expect, it } from "vitest";
import { ingredientMarkdown, parseIngredients, parseSteps, scaledAmount, stepsMarkdown } from "./recipe";

describe("structured recipe Markdown", () => {
  it("round trips ingredients and steps as readable lists", () => {
    expect(parseIngredients("- 500 g Potet\n- Salt etter smak")).toEqual([
      { amount: "500", unit: "g", name: "Potet" }, { amount: "", unit: "", name: "Salt etter smak" }
    ]);
    expect(ingredientMarkdown(parseIngredients("- 500 g Potet\n- Salt etter smak"))).toBe("- 500 g Potet\n- Salt etter smak");
    expect(stepsMarkdown(parseSteps("1. Kok opp\n2. Stek gyllen"))).toBe("1. Kok opp\n2. Stek gyllen");
  });
  it("scales decimal and fractional quantities", () => {
    expect(scaledAmount("500", 4, 2)).toBe("250");
    expect(scaledAmount("1/2", 4, 6)).toBe("0,75");
  });
});
