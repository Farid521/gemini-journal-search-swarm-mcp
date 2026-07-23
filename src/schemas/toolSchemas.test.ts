import { describe, it, expect } from "vitest";
import { searchAndCheckJournalsInputSchema } from "./toolSchemas.js";

describe("searchAndCheckJournalsInputSchema", () => {
  it("REGRESI: payload lama (3 field) tetap valid", () => {
    const parsed = searchAndCheckJournalsInputSchema.parse({
      query: "fisika",
      max_candidates: 5,
      search_depth: "basic",
    });
    expect(parsed.search_provider).toBe("tavily"); // default diterapkan
    expect(parsed.max_candidates).toBe(5);
    expect(parsed.search_depth).toBe("basic");
  });

  it("menerima search_provider='exa' dengan exa_search_type", () => {
    const parsed = searchAndCheckJournalsInputSchema.parse({
      query: "biologi",
      search_provider: "exa",
      exa_search_type: "keyword",
    });
    expect(parsed.search_provider).toBe("exa");
    expect(parsed.exa_search_type).toBe("keyword");
  });

  it("menolak search_provider dengan value di luar enum", () => {
    expect(() =>
      searchAndCheckJournalsInputSchema.parse({
        query: "test",
        search_provider: "google",
      })
    ).toThrow();
  });

  it("menolak exa_search_type dengan value di luar enum", () => {
    expect(() =>
      searchAndCheckJournalsInputSchema.parse({
        query: "test",
        exa_search_type: "fuzzy",
      })
    ).toThrow();
  });

  it("GUARD: schema TIDAK memiliki field category / exa_category", () => {
    const shape = searchAndCheckJournalsInputSchema.shape as Record<string, unknown>;
    expect(shape).not.toHaveProperty("category");
    expect(shape).not.toHaveProperty("exa_category");
  });

  it("query tanpa search_provider tetap wajib diisi (tidak berubah)", () => {
    expect(() =>
      searchAndCheckJournalsInputSchema.parse({ search_provider: "exa" })
    ).toThrow();
  });
});
