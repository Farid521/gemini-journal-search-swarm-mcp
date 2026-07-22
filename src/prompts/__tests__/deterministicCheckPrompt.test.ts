import { describe, it, expect } from "vitest";
import {
  buildCriteriaBlock,
  buildFormatEnforcementBlock,
  buildDeterministicInstruction,
} from "../deterministicCheckPrompt.js";

describe("buildCriteriaBlock", () => {
  const block = buildCriteriaBlock(15000);

  it("contains journal_title criterion (no. 4)", () => {
    expect(block).toContain("journal_title");
    expect(block).toContain("ekstrak judul jurnal");
  });

  it("contains apa_citation criterion (no. 5)", () => {
    expect(block).toContain("apa_citation");
    expect(block).toContain("sitasi APA style");
    expect(block).toContain("edisi 7");
  });

  it("does not contain format enforcement instructions", () => {
    expect(block).not.toContain('"is_relevant"');
  });
});

describe("buildFormatEnforcementBlock", () => {
  const block = buildFormatEnforcementBlock();

  it("contains journal_title field", () => {
    expect(block).toContain("journal_title");
    expect(block).toContain("judul jurnal");
  });

  it("contains apa_citation field", () => {
    expect(block).toContain("apa_citation");
    expect(block).toContain("sitasi APA style edisi 7");
  });

  it("contains all 7 fields in total", () => {
    const fields = [
      "is_relevant",
      "has_basic_explanation",
      "has_basic_equations",
      "confidence",
      "reason",
      "journal_title",
      "apa_citation",
    ];
    for (const field of fields) {
      expect(block).toContain(field);
    }
  });

  it("is valid JSON-like object format", () => {
    // Validate that the block is a proper JSON-like structure
    expect(block).toMatch(/{/);
    expect(block).toMatch(/}/);
  });
});

describe("buildDeterministicInstruction", () => {
  const instruction = buildDeterministicInstruction(15000);

  it("combines criteria and format enforcement", () => {
    expect(instruction).toContain("ekstrak judul jurnal");
    expect(instruction).toContain("sitasi APA style edisi 7");
    expect(instruction).toContain('"journal_title"');
    expect(instruction).toContain('"apa_citation"');
    expect(instruction).toContain('"is_relevant"');
  });

  it("includes maxChars in the output", () => {
    expect(instruction).toContain("15000");
  });
});
