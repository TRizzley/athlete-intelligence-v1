// ----------------------------------------------------------------------------
// Nutritionix Track API v2 client — server-only.
//
// Docs: https://trackapi.nutritionix.com/docs
// Auth: x-app-id + x-app-key headers (set in env vars — never exposed client-side).
//
// Three public functions:
//   parseFoods(text)          — natural language → array of NutritionixFood
//   searchFoods(query)        — instant search → branded + common results
//   getNutrientsByNixId(id)   — single branded item full nutrient breakdown
// ----------------------------------------------------------------------------

export interface NutritionixFood {
  food_name: string;
  brand_name: string | null;
  nix_item_id: string | null;
  serving_qty: number;
  serving_unit: string;
  serving_weight_grams: number | null;
  nf_calories: number;
  nf_total_fat: number | null;
  nf_saturated_fat: number | null;
  nf_cholesterol: number | null;
  nf_sodium: number | null;
  nf_total_carbohydrate: number | null;
  nf_dietary_fiber: number | null;
  nf_sugars: number | null;
  nf_protein: number | null;
  photo: { thumb: string } | null;
}

export interface NutritionixSearchResult {
  branded: NutritionixSearchItem[];
  common: NutritionixSearchItem[];
}

export interface NutritionixSearchItem {
  food_name: string;
  brand_name?: string;
  nix_item_id?: string;
  photo: { thumb: string } | null;
  serving_qty?: number;
  serving_unit?: string;
  nf_calories?: number;
}

export class NutritionixError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "NutritionixError";
  }
}

function getHeaders(): HeadersInit {
  const appId = process.env.NUTRITIONIX_APP_ID;
  const appKey = process.env.NUTRITIONIX_APP_KEY;

  if (!appId || !appKey) {
    throw new NutritionixError(
      "Missing NUTRITIONIX_APP_ID or NUTRITIONIX_APP_KEY environment variables.",
    );
  }

  return {
    "Content-Type": "application/json",
    "x-app-id": appId,
    "x-app-key": appKey,
  };
}

/**
 * Parse natural language food input into structured nutrition data.
 * Example: "3 eggs and a cup of oats" → [egg item, oat item]
 */
export async function parseFoods(naturalText: string): Promise<NutritionixFood[]> {
  if (!naturalText.trim()) {
    throw new NutritionixError("Food input cannot be empty.");
  }

  const res = await fetch("https://trackapi.nutritionix.com/v2/natural/nutrients", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ query: naturalText }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new NutritionixError(
      `Nutritionix parse failed (${res.status}): ${body}`,
      res.status,
    );
  }

  const data = await res.json() as { foods: NutritionixFood[] };
  return data.foods ?? [];
}

/**
 * Instant search — returns branded and common food matches.
 * Good for autocomplete / food picker UI.
 */
export async function searchFoods(query: string): Promise<NutritionixSearchResult> {
  if (!query.trim()) {
    return { branded: [], common: [] };
  }

  const params = new URLSearchParams({
    query,
    branded: "true",
    common: "true",
    self: "false",
  });

  const res = await fetch(
    `https://trackapi.nutritionix.com/v2/search/instant?${params}`,
    { headers: getHeaders() },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new NutritionixError(
      `Nutritionix search failed (${res.status}): ${body}`,
      res.status,
    );
  }

  const data = await res.json() as NutritionixSearchResult;
  return {
    branded: data.branded ?? [],
    common: data.common ?? [],
  };
}

/**
 * Fetch full nutrient breakdown for a single branded item by its Nutritionix ID.
 * Use when the user selects a specific branded product from search results.
 */
export async function getNutrientsByNixId(nixItemId: string): Promise<NutritionixFood> {
  const res = await fetch("https://trackapi.nutritionix.com/v2/search/item", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ nix_item_id: nixItemId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new NutritionixError(
      `Nutritionix item lookup failed (${res.status}): ${body}`,
      res.status,
    );
  }

  const data = await res.json() as { foods: NutritionixFood[] };
  const food = data.foods?.[0];
  if (!food) {
    throw new NutritionixError(`No food found for nix_item_id: ${nixItemId}`);
  }
  return food;
}
