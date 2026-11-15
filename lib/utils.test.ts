/**
 * Tests for the pure helpers in lib/utils.ts. No database, no Clerk,
 * no network. `formUrlQuery` / `removeKeysFromQuery` read
 * `window.location.pathname`, so the tests stub a minimal `window`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assignBadges,
  cn,
  formatAIGeneratedText,
  formatNumber,
  formUrlQuery,
  getMonthYear,
  getTimestamp,
  removeKeysFromQuery,
} from "./utils";

describe("cn", () => {
  it("merges class names and lets tailwind-merge resolve conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", undefined, "font-bold")).toBe("text-sm font-bold");
    expect(cn({ hidden: true, block: false })).toBe("hidden");
  });
});

describe("getTimestamp", () => {
  const ago = (ms: number): Date => new Date(Date.now() - ms);

  it("reports seconds for under two minutes", () => {
    expect(getTimestamp(ago(30 * 1000))).toBe("30 seconds ago");
    // Exactly one minute still reads as seconds: the check is `> 1`.
    expect(getTimestamp(ago(61 * 1000))).toBe("61 seconds ago");
  });

  it("reports minutes, hours, days, months and years past the boundary", () => {
    expect(getTimestamp(ago(2 * 60 * 1000))).toBe("2 minutes ago");
    expect(getTimestamp(ago(2 * 60 * 60 * 1000))).toBe("2 hours ago");
    expect(getTimestamp(ago(2 * 24 * 60 * 60 * 1000))).toBe("2 days ago");
    expect(getTimestamp(ago(60 * 24 * 60 * 60 * 1000))).toBe("2 months ago");
    expect(getTimestamp(ago(730 * 24 * 60 * 60 * 1000))).toBe("2 years ago");
  });
});

describe("formatNumber", () => {
  it("returns small numbers unchanged", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats thousands with one decimal and a K suffix", () => {
    expect(formatNumber(1000)).toBe("1.0K");
    expect(formatNumber(1500)).toBe("1.5K");
  });

  it("formats millions with one decimal and an M suffix", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
    expect(formatNumber(2_500_000)).toBe("2.5M");
  });
});

describe("getMonthYear", () => {
  it("formats a date as 'Month Year' in en-US", () => {
    expect(getMonthYear(new Date(2026, 0, 15))).toBe("January 2026");
    expect(getMonthYear(new Date(2025, 11, 1))).toBe("December 2025");
  });
});

describe("formUrlQuery and removeKeysFromQuery", () => {
  it("sets a query key on the current pathname", () => {
    vi.stubGlobal("window", { location: { pathname: "/questions" } });
    expect(
      formUrlQuery({ params: "page=1", key: "filter", value: "newest" }),
    ).toBe("/questions?filter=newest&page=1");
    vi.unstubAllGlobals();
  });

  it("drops a key whose value is null (skipNull)", () => {
    vi.stubGlobal("window", { location: { pathname: "/tags" } });
    expect(
      formUrlQuery({ params: "filter=popular", key: "filter", value: null }),
    ).toBe("/tags");
    vi.unstubAllGlobals();
  });

  it("removes the named keys and keeps the rest", () => {
    vi.stubGlobal("window", { location: { pathname: "/community" } });
    expect(
      removeKeysFromQuery({
        params: "page=2&filter=top",
        keysToRemove: ["page"],
      }),
    ).toBe("/community?filter=top");
    vi.unstubAllGlobals();
  });
});

describe("assignBadges", () => {
  it("awards no badge below the BRONZE threshold", () => {
    expect(
      assignBadges({ criteria: [{ type: "QUESTION_COUNT", count: 9 }] }),
    ).toEqual({ GOLD: 0, SILVER: 0, BRONZE: 0 });
  });

  it("awards BRONZE at 10, SILVER at 50 and GOLD at 100", () => {
    expect(
      assignBadges({ criteria: [{ type: "QUESTION_COUNT", count: 10 }] }),
    ).toEqual({ GOLD: 0, SILVER: 0, BRONZE: 1 });
    expect(
      assignBadges({ criteria: [{ type: "ANSWER_COUNT", count: 50 }] }),
    ).toEqual({ GOLD: 0, SILVER: 1, BRONZE: 1 });
    expect(
      assignBadges({ criteria: [{ type: "QUESTION_UPVOTES", count: 100 }] }),
    ).toEqual({ GOLD: 1, SILVER: 1, BRONZE: 1 });
  });

  it("accumulates badges across criteria and uses the TOTAL_VIEWS scale", () => {
    expect(
      assignBadges({
        criteria: [
          { type: "QUESTION_COUNT", count: 10 },
          { type: "ANSWER_COUNT", count: 10 },
          { type: "TOTAL_VIEWS", count: 1000 },
        ],
      }),
    ).toEqual({ GOLD: 0, SILVER: 0, BRONZE: 3 });
    expect(
      assignBadges({ criteria: [{ type: "TOTAL_VIEWS", count: 999 }] }),
    ).toEqual({ GOLD: 0, SILVER: 0, BRONZE: 0 });
  });
});

describe("formatAIGeneratedText", () => {
  it("converts markdown-ish lines to the expected HTML", () => {
    const input = [
      "**Summary**",
      "* **Using hooks**:",
      " * useState",
      "  const x = 1;",
      "",
      "plain text",
    ].join("\n");

    expect(formatAIGeneratedText(input)).toBe(
      "<h3>Summary</h3>\n" +
        "<h4> hooks</h4>\n" +
        "<ul><li>useState</li></ul>\n" +
        "<pre><code>const x = 1;</code></pre>\n" +
        "<br/>" +
        "<p>plain text</p>\n",
    );
  });
});
