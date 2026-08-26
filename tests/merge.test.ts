import { describe, expect, it } from "vitest";
import { deepMerge, isPlainObject } from "../server/lib/merge.js";

describe("deepMerge", () => {
  it("浅层合并覆盖标量", () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it("递归合并嵌套对象", () => {
    expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({
      a: { x: 1, y: 3, z: 4 },
    });
  });

  it("数组整体替换而非拼接", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it("patch 非对象时直接替换", () => {
    expect(deepMerge({ a: 1 }, null)).toBeNull();
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it("target 非对象时返回 patch", () => {
    expect(deepMerge(null as unknown as object, { a: 1 })).toEqual({ a: 1 });
  });

  it("isPlainObject 区分普通对象与数组/null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});
