/**
 * Tests for escapeRegExp (lib/utils.ts) — the shared helper that makes
 * user-supplied search terms safe inside a RegExp / MongoDB $regex.
 * Without it, a term containing regex syntax throws (invalid pattern)
 * or matches far more than the literal text.
 */
import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./utils";

describe("escapeRegExp", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeRegExp("react hooks")).toBe("react hooks");
    expect(escapeRegExp("useState")).toBe("useState");
  });

  it("escapes every regex metacharacter", () => {
    expect(escapeRegExp(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
    );
  });

  it("makes terms with regex syntax build a working RegExp", () => {
    for (const term of ["a(b", "c[d", "x.*y", "^start$", "a+b", "a|b", "a\\b"]) {
      const regex = new RegExp(escapeRegExp(term), "i");
      expect(regex.test(term)).toBe(true);
    }
  });

  it("matches literally, not as a pattern", () => {
    // ".*" unescaped would match anything; escaped it matches only ".*".
    expect(new RegExp(escapeRegExp(".*"), "i").test("anything")).toBe(false);
    expect(new RegExp(escapeRegExp(".*"), "i").test(".*")).toBe(true);
    expect(new RegExp(escapeRegExp("(a)"), "i").test("xaY")).toBe(false);
  });

  it("does not throw for an unbalanced bracket", () => {
    expect(() => new RegExp(escapeRegExp("array["), "i")).not.toThrow();
  });
});
