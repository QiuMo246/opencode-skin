import { describe, expect, it } from "vitest";
import { parseJsonc } from "../server/lib/terminal.js";

describe("parseJsonc", () => {
  it("解析普通 JSON", () => {
    expect(parseJsonc('{"a":1}')).toEqual({ a: 1 });
  });

  it("容忍尾逗号", () => {
    expect(parseJsonc('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });

  it("容忍 BOM 与行注释", () => {
    const text = '\uFEFF{\n// 注释\n"a": 1 // 行尾注释\n}';
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  it("移除真正的块注释", () => {
    const text = '{\n/* 多行\n注释 */\n"a": /* 行内 */ 1\n}';
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  it("字符串内的 /* 不当作注释", () => {
    expect(parseJsonc('{"cmd":"foo /* not a comment */ bar"}')).toEqual({
      cmd: "foo /* not a comment */ bar",
    });
  });

  it("字符串内的 // 不当作注释", () => {
    expect(parseJsonc('{"url":"http://example.com//x"}')).toEqual({ url: "http://example.com//x" });
  });

  it("字符串内的转义引号不破坏状态机", () => {
    expect(parseJsonc('{"a":"say \\"hi\\" // ok"}')).toEqual({ a: 'say "hi" // ok' });
  });

  it("未闭合的块注释吞到结尾", () => {
    expect(parseJsonc('{"a":1} /* 未闭合')).toEqual({ a: 1 });
  });

  it("非法输入返回 null", () => {
    expect(parseJsonc("{oops")).toBeNull();
  });
});
