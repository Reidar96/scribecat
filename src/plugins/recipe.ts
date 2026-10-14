/** A recipe remains ordinary Markdown; only its list rows have structured inputs. */
export type Ingredient = { amount: string; unit: string; name: string };

export function parseIngredients(section: string): Ingredient[] {
  return section.split(/\r?\n/).filter((line) => /^-\s+\S/.test(line)).map((line) => {
    const text = line.replace(/^-\s+/, "");
    const match = /^(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(\S+)\s+(.+)$/i.exec(text);
    return match ? { amount: match[1], unit: match[2], name: match[3] } : { amount: "", unit: "", name: text };
  });
}

export function ingredientMarkdown(items: Ingredient[]): string {
  return items.filter((item) => item.name.trim()).map((item) => `- ${[item.amount.trim(), item.unit.trim(), item.name.trim().replace(/[\r\n]/g, " ")].filter(Boolean).join(" ")}`).join("\n");
}

export function parseSteps(section: string): string[] {
  return section.split(/\r?\n/).filter((line) => /^\d+\.\s+\S/.test(line)).map((line) => line.replace(/^\d+\.\s+/, ""));
}

export function stepsMarkdown(steps: string[]): string {
  return steps.filter((step) => step.trim()).map((step, index) => `${index + 1}. ${step.trim().replace(/[\r\n]/g, " ")}`).join("\n");
}

export function scaledAmount(amount: string, baseServings: number, servings: number): string {
  if (!amount || !(baseServings > 0) || !(servings > 0)) return amount;
  const parts = amount.split("/");
  const value = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(amount.replace(",", "."));
  if (!Number.isFinite(value)) return amount;
  const scaled = Math.round(value * servings / baseServings * 100) / 100;
  return String(scaled).replace(".", ",");
}
