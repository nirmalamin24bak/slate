// System prompt for the classify model (spec/05 "System prompt" shape).
// The catalogue is injected per request, never memorised: adding a dish makes
// the resolver know it on the next catalogue refresh. The model NEVER emits a
// calorie — it maps text to structure, and the client recomputes everything
// against its own tables anyway.

export interface CatalogueDish {
  id: string;
  name: string;
  aliases: string[] | null;
  default_unit: string;
  default_qty: number;
}

export interface CatalogueExercise {
  id: string;
  name: string;
  aliases: string[] | null;
  unit: string;
}

export interface CataloguePackagedFood {
  barcode: string;
  brand: string | null;
  name: string | null;
}

export interface Catalogue {
  dishes: CatalogueDish[];
  exercises: CatalogueExercise[];
  packagedFoods: CataloguePackagedFood[];
}

function dishLine(d: CatalogueDish): string {
  const aliases = d.aliases?.length ? ` (${d.aliases.join(', ')})` : '';
  return `${d.id}: ${d.name}${aliases} — default ${d.default_qty} ${d.default_unit}`;
}

function exerciseLine(e: CatalogueExercise): string {
  const aliases = e.aliases?.length ? ` (${e.aliases.join(', ')})` : '';
  return `${e.id}: ${e.name}${aliases} — unit ${e.unit}`;
}

function packagedLine(p: CataloguePackagedFood): string {
  return `${p.barcode}: ${[p.brand, p.name].filter(Boolean).join(' ')}`;
}

export function buildSystemPrompt(catalogue: Catalogue): string {
  return `You classify Indian food journal entries. You never state calories.

Given a line of text, return JSON only. No prose, no markdown fences.
A single entry is one object; a line describing several things is an array
of objects. The user writes Hinglish. "2 roti aur ek katori dal" is two
entries, not one. Split on conjunctions and return an array.

Each object:
{"intent": ..., "ref": ..., "qty": ..., "unit": ..., "context": ..., "confidence": ...}

intent: "food" | "exercise" | "weight" | "water" | "steps" | "sleep"
ref:    an id from the catalogue below. Never invent one.
        null for weight, water, steps, sleep.
qty:    positive number. If the text gives no quantity, use the dish's
        default quantity and unit from the catalogue.
unit:   katori | plate | glass | cup | piece | roti | tbsp | tsp |
        g | ml | kg | l | minutes | km | steps | hours
context: "outside" if the text implies a restaurant, hotel, or delivery
        (swiggy, zomato, ordered, outside, hotel, restaurant, canteen,
        bahar, dhaba). otherwise "home".
confidence: 0-1. Below 0.6 means you are guessing. Say so.

Weight: first-person body phrasing ("I weigh", "I'm at", "weigh-in")
beats everything. A bare mass is weight only with no food noun and a
value between 30 and 250 kg. "2 kg chicken" is food. A bare integer is
food.

If a line names a food you cannot match to the catalogue, return
confidence 0.0 rather than the nearest neighbour. A wrong match is
worse than no match.

DISHES
${catalogue.dishes.map(dishLine).join('\n')}

EXERCISES
${catalogue.exercises.map(exerciseLine).join('\n')}

PACKAGED FOODS (ref is the barcode)
${catalogue.packagedFoods.map(packagedLine).join('\n')}`;
}
