import { describe, expect, it } from "vitest";
import { callCard, parameterNames, schemaShape, validateCallArgs } from "../src/call-card.js";

const queryDataSources = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        query: { type: "string" },
        data_source_urls: { type: "array", items: { type: "string" } },
      },
      required: ["query", "data_source_urls"],
    },
  },
  required: ["data"],
};

const baseOrBranch = {
  type: "object",
  properties: { base: { type: "string" } },
  required: ["base"],
  anyOf: [
    { properties: { a: { type: "string" } }, required: ["a"] },
    { properties: { b: { type: "string" } }, required: ["b"] },
  ],
};

describe("call cards", () => {
  it("summarizes nested required keys and an example", () => {
    expect(schemaShape(queryDataSources)).toBe("{ data: { query, data_source_urls } }");
    const card = callCard(queryDataSources);
    expect(card.fields).toEqual([
      { name: "data.query", type: "string", required: true },
      { name: "data.data_source_urls", type: "string[]", required: true },
    ]);
    expect(card.example).toEqual({ data: { query: "", data_source_urls: [""] } });
    expect(validateCallArgs(queryDataSources, card.example)).toBeNull();
  });

  it("indexes nested parameter names", () => {
    expect(parameterNames(queryDataSources)).toEqual(["data", "query", "data_source_urls"]);
  });

  it("composes parent properties with anyOf branches", () => {
    expect(schemaShape(baseOrBranch)).toBe("{ base, a } | { base, b }");
    const card = callCard(baseOrBranch);
    expect(card.example).toEqual({ base: "", a: "" });
    expect(card.fields).toEqual([
      { name: "base", type: "string", required: true },
      { name: "a", type: "string", required: false },
      { name: "b", type: "string", required: false },
    ]);
    expect(validateCallArgs(baseOrBranch, card.example)).toBeNull();
    expect(validateCallArgs(baseOrBranch, { a: "yes" })).toContain("missing base");
    expect(validateCallArgs(baseOrBranch, { base: "x", a: "yes" })).toBeNull();
  });

  it("picks the richest anyOf object for the card", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                query: { type: "string" },
                data_source_urls: { type: "array", items: { type: "string" } },
              },
              required: ["query", "data_source_urls"],
            },
          ],
        },
      },
      required: ["data"],
    };
    expect(schemaShape(schema)).toBe("{ data: string | { query, data_source_urls } }");
    expect(validateCallArgs(schema, { query: "today" })).toContain("missing data");
    expect(validateCallArgs(schema, { data: { query: "today", data_source_urls: [] } })).toBeNull();
    expect(validateCallArgs(schema, { data: "https://example" })).toBeNull();
  });

  it("marks required children of optional parents as optional", () => {
    const schema = {
      type: "object",
      properties: {
        extra: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    };
    expect(callCard(schema).fields).toEqual([{ name: "extra.name", type: "string", required: false }]);
  });

  it("keeps a 2000-property card under the size budget", () => {
    const properties: Record<string, { type: string }> = {};
    for (let i = 0; i < 2000; i++) properties[`p${i}`] = { type: "string" };
    const card = callCard({ type: "object", properties, required: Object.keys(properties) });
    expect(JSON.stringify(card).length).toBeLessThan(2000);
    expect(card.shape.length).toBeLessThan(500);
    expect(card.fields.length).toBeLessThanOrEqual(24);
    expect(Object.keys(card.example).length).toBeLessThanOrEqual(6);
  });
});

describe("local call validation", () => {
  it("explains the expected shape instead of a remote type error", () => {
    expect(validateCallArgs(queryDataSources, { query: "today" })).toBe(
      "expected { data: { query, data_source_urls } }. missing data",
    );
    expect(validateCallArgs(queryDataSources, { data: { query: "today" } })).toBe(
      "expected { data: { query, data_source_urls } }. missing data.data_source_urls",
    );
    expect(validateCallArgs(queryDataSources, { data: { query: "today", data_source_urls: [] } })).toBeNull();
  });

  it("skips empty schemas", () => {
    expect(validateCallArgs({ type: "object" }, { anything: true })).toBeNull();
  });

  it("compares object enums by value", () => {
    const schema = {
      type: "object",
      properties: { mode: { enum: [{ type: "sql" }, { type: "view" }] } },
      required: ["mode"],
    };
    expect(validateCallArgs(schema, { mode: { type: "sql" } })).toBeNull();
    expect(validateCallArgs(schema, { mode: { type: "other" } })).toContain("one of");
  });

  it("requires exactly one oneOf branch", () => {
    const schema = {
      type: "object",
      oneOf: [
        { properties: { a: { type: "string" } }, required: ["a"] },
        { properties: { b: { type: "string" } }, required: ["b"] },
      ],
    };
    expect(validateCallArgs(schema, { a: "yes" })).toBeNull();
    expect(validateCallArgs(schema, { a: "yes", b: "no" })).toContain("more than one");
  });

  it("validates array items", () => {
    const schema = {
      type: "object",
      properties: { urls: { type: "array", items: { type: "string" } } },
      required: ["urls"],
    };
    expect(validateCallArgs(schema, { urls: ["https://example"] })).toBeNull();
    expect(validateCallArgs(schema, { urls: [42] })).toContain("should be string");
  });

  it("merges overlapping allOf properties instead of overwriting", () => {
    const schema = {
      allOf: [
        { type: "object", properties: { data: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } }, required: ["data"] },
        { type: "object", properties: { data: { type: "object", properties: { b: { type: "string" } }, required: ["b"] } } },
      ],
    };
    expect(validateCallArgs(schema, { data: { a: "yes" } })).toContain("missing data.b");
    expect(validateCallArgs(schema, { data: { a: "yes", b: "ok" } })).toBeNull();
  });
});
