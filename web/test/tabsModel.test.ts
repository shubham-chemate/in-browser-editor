import { describe, expect, it } from "vitest";
import { closeTabs, dropIndex, moveTab, openTab, restoreTabs, tabsRightOf } from "../src/tabsModel";

describe("openTab", () => {
  it("inserts right after the active tab", () => {
    expect(openTab(["a", "b", "c"], "x", "a")).toEqual(["a", "x", "b", "c"]);
  });
  it("appends when there is no active tab", () => {
    expect(openTab(["a"], "x", null)).toEqual(["a", "x"]);
    expect(openTab([], "x", null)).toEqual(["x"]);
  });
  it("doesn't duplicate an already-open tab or move it", () => {
    expect(openTab(["a", "b", "c"], "c", "a")).toEqual(["a", "b", "c"]);
  });
});

describe("closeTabs", () => {
  it("closing a background tab keeps the active one", () => {
    expect(closeTabs(["a", "b", "c"], ["a"], "b")).toEqual({ tabs: ["b", "c"], active: "b" });
  });
  it("closing the active tab activates its right neighbour", () => {
    expect(closeTabs(["a", "b", "c"], ["b"], "b")).toEqual({ tabs: ["a", "c"], active: "c" });
  });
  it("…or its left neighbour when it was last", () => {
    expect(closeTabs(["a", "b", "c"], ["c"], "c")).toEqual({ tabs: ["a", "b"], active: "b" });
  });
  it("skips neighbours that are closing too", () => {
    expect(closeTabs(["a", "b", "c", "d"], ["b", "c"], "b")).toEqual({ tabs: ["a", "d"], active: "d" });
  });
  it("closing everything leaves no active tab", () => {
    expect(closeTabs(["a", "b"], ["a", "b"], "a")).toEqual({ tabs: [], active: null });
  });
  it("close others / to the right", () => {
    const tabs = ["a", "b", "c", "d"];
    expect(closeTabs(tabs, tabs.filter((t) => t !== "b"), "d")).toEqual({ tabs: ["b"], active: "b" });
    expect(closeTabs(tabs, tabsRightOf(tabs, "b"), "d")).toEqual({ tabs: ["a", "b"], active: "b" });
  });
});

describe("moveTab", () => {
  it("moves forward and backward", () => {
    expect(moveTab(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTab(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("clamps out-of-range targets", () => {
    expect(moveTab(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveTab(["a", "b", "c"], "c", -5)).toEqual(["c", "a", "b"]);
  });
  it("ignores unknown ids", () => {
    expect(moveTab(["a", "b"], "zz", 0)).toEqual(["a", "b"]);
  });
});

describe("restoreTabs", () => {
  it("drops missing, duplicate and non-string entries", () => {
    expect(restoreTabs(["a", "gone", "b", "a", 3, null], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });
  it("handles garbage", () => {
    expect(restoreTabs("nope", new Set(["a"]))).toEqual([]);
    expect(restoreTabs(null, new Set(["a"]))).toEqual([]);
  });
});

describe("dropIndex", () => {
  // three other tabs, each 100px wide, starting at 0
  const others = [0, 100, 200].map((left) => ({ left, width: 100 }));
  it("finds the slot by comparing against midpoints", () => {
    expect(dropIndex(others, 10)).toBe(0);
    expect(dropIndex(others, 49)).toBe(0);
    expect(dropIndex(others, 51)).toBe(1);
    expect(dropIndex(others, 160)).toBe(2);
    expect(dropIndex(others, 999)).toBe(3);
  });
});
