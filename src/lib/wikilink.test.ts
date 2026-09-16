import { describe, it, expect } from "vitest";
import { protectWikilinks, restoreWikilinks } from "./wikilink";

describe("protectWikilinks / restoreWikilinks", () => {
  it("链接与嵌入均往返还原", () => {
    const md = "参见 [[另一篇笔记]] 与 ![[嵌入块]]，以及 [[a|别名]] 和 [[x#标题]]。";
    const { body, map } = protectWikilinks(md);
    expect(body).not.toContain("[[");
    expect(body).toContain("⟦另一篇笔记⟧");
    expect(body).toContain("⟦!嵌入块⟧");
    expect(restoreWikilinks(body, map)).toBe(md); // 字节级还原
  });

  it("无 wikilink 时不受影响", () => {
    const md = "# 标题\n\n普通 [链接](https://x.com) 文本。";
    const { body, map } = protectWikilinks(md);
    expect(body).toBe(md);
    expect(map.size).toBe(0);
    expect(restoreWikilinks(body, map)).toBe(md);
  });

  it("用户手写 ⟦⟧ 不误还原（map 无对应 key）", () => {
    const { body, map } = protectWikilinks("数学符号 ⟦foo⟧ 在这里。");
    expect(body).toBe("数学符号 ⟦foo⟧ 在这里。");
    expect(restoreWikilinks(body, map)).toBe("数学符号 ⟦foo⟧ 在这里。");
  });

  it("同一内文的链接与嵌入不互相串", () => {
    const md = "A [[x]] B ![[x]] C";
    const { body, map } = protectWikilinks(md);
    expect(body).toBe("A ⟦x⟧ B ⟦!x⟧ C");
    expect(restoreWikilinks(body, map)).toBe(md);
  });
});
