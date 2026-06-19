import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseFoods,
  searchFoods,
  getNutrientsByNixId,
  NutritionixError,
  type NutritionixFood,
} from "../nutritionix";

// A minimal valid food item as the Track API returns it.
function food(overrides: Partial<NutritionixFood> = {}): NutritionixFood {
  return {
    food_name: "egg",
    brand_name: null,
    nix_item_id: null,
    serving_qty: 3,
    serving_unit: "large",
    serving_weight_grams: 150,
    nf_calories: 215,
    nf_total_fat: 14,
    nf_saturated_fat: 4,
    nf_cholesterol: 560,
    nf_sodium: 210,
    nf_total_carbohydrate: 1,
    nf_dietary_fiber: 0,
    nf_sugars: 1,
    nf_protein: 19,
    photo: null,
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NUTRITIONIX_APP_ID = "test_id";
  process.env.NUTRITIONIX_APP_KEY = "test_key";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NUTRITIONIX_APP_ID;
  delete process.env.NUTRITIONIX_APP_KEY;
});

describe("parseFoods", () => {
  it("attaches auth headers and returns parsed foods", async () => {
    const fetchMock = mockFetch({ foods: [food()] });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseFoods("3 eggs");

    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe("egg");

    // Verify the request: correct URL, method, and auth headers.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v2/natural/nutrients");
    expect(init.method).toBe("POST");
    expect(init.headers["x-app-id"]).toBe("test_id");
    expect(init.headers["x-app-key"]).toBe("test_key");
    expect(JSON.parse(init.body)).toEqual({ query: "3 eggs" });
  });

  it("returns an empty array when the API omits foods", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    expect(await parseFoods("nonsense")).toEqual([]);
  });

  it("throws NutritionixError on a non-200 response", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "bad" }, false, 404));
    await expect(parseFoods("3 eggs")).rejects.toBeInstanceOf(NutritionixError);
    await expect(parseFoods("3 eggs")).rejects.toMatchObject({ status: 404 });
  });

  it("throws on empty input without calling the API", async () => {
    const fetchMock = mockFetch({ foods: [] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(parseFoods("   ")).rejects.toBeInstanceOf(NutritionixError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when credentials are missing", async () => {
    delete process.env.NUTRITIONIX_APP_ID;
    vi.stubGlobal("fetch", mockFetch({ foods: [food()] }));
    await expect(parseFoods("3 eggs")).rejects.toBeInstanceOf(NutritionixError);
  });
});

describe("searchFoods", () => {
  it("returns branded and common results", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        branded: [{ food_name: "Clif Bar", nix_item_id: "abc", photo: null }],
        common: [{ food_name: "banana", photo: null }],
      }),
    );
    const res = await searchFoods("bar");
    expect(res.branded).toHaveLength(1);
    expect(res.common[0].food_name).toBe("banana");
  });

  it("short-circuits on a blank query", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchFoods("  ")).toEqual({ branded: [], common: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws NutritionixError on a non-200 response", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 500));
    await expect(searchFoods("bar")).rejects.toBeInstanceOf(NutritionixError);
  });
});

describe("getNutrientsByNixId", () => {
  it("returns the first food in the response", async () => {
    vi.stubGlobal("fetch", mockFetch({ foods: [food({ food_name: "Clif Bar" })] }));
    const res = await getNutrientsByNixId("abc");
    expect(res.food_name).toBe("Clif Bar");
  });

  it("throws when no food is found", async () => {
    vi.stubGlobal("fetch", mockFetch({ foods: [] }));
    await expect(getNutrientsByNixId("missing")).rejects.toBeInstanceOf(NutritionixError);
  });
});
