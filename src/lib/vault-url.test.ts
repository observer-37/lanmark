import { describe, it, expect } from "vitest";
import {
  isExternal,
  resolveFrom,
  relativeFrom,
  toVaultUrl,
  fromVaultUrl,
  vaultUrlsToRelative,
} from "./vault-url";

describe("isExternal", () => {
  it("外部/绝对 URL 不走 vault 协议", () => {
    expect(isExternal("https://example.com/x.png")).toBe(true);
    expect(isExternal("http://x/y")).toBe(true);
    expect(isExternal("data:image/png;base64,AAA")).toBe(true);
    expect(isExternal("vault://localhost/a/b.png")).toBe(true);
    expect(isExternal("/abs/path.png")).toBe(true);
    expect(isExternal("C:\\img\\x.png")).toBe(true);
  });
  it("相对引用走 vault 协议", () => {
    expect(isExternal("assets/x.png")).toBe(false);
    expect(isExternal("../img/x.png")).toBe(false);
    expect(isExternal("x.png")).toBe(false);
  });
});

describe("resolveFrom（相对笔记目录 → vault 相对路径）", () => {
  it("根目录笔记", () => {
    expect(resolveFrom("", "assets/x.png")).toBe("assets/x.png");
  });
  it("子目录笔记引用本目录资源", () => {
    expect(resolveFrom("工作", "assets/x.png")).toBe("工作/assets/x.png");
  });
  it("向上跳转", () => {
    expect(resolveFrom("a/b", "../x.png")).toBe("a/x.png");
    expect(resolveFrom("a/b", "../../x.png")).toBe("x.png");
  });
  it("越出根目录截断（协议层 404 兜底）", () => {
    expect(resolveFrom("a", "../../../x.png")).toBe("x.png");
  });
});

describe("relativeFrom（Obsidian 风格引用生成）", () => {
  it("根笔记 → 根资源", () => {
    expect(relativeFrom("", "assets/x.png")).toBe("assets/x.png");
  });
  it("子目录笔记 → 根资源", () => {
    expect(relativeFrom("工作", "assets/x.png")).toBe("../assets/x.png");
  });
  it("同目录", () => {
    expect(relativeFrom("a", "a/x.png")).toBe("x.png");
  });
  it("深层 → 浅层", () => {
    expect(relativeFrom("a/b/c", "a/x.png")).toBe("../../x.png");
  });
});

describe("toVaultUrl / fromVaultUrl", () => {
  it("中文路径 percent-encode", () => {
    expect(toVaultUrl("读书/图.png")).toBe(
      "vault://localhost/" + encodeURIComponent("读书") + "/" + encodeURIComponent("图.png"),
    );
  });
  it("fromVaultUrl 还原", () => {
    expect(fromVaultUrl(toVaultUrl("a/b.png"))).toBe("a/b.png");
    expect(fromVaultUrl("plain.png")).toBe("plain.png"); // 非协议 URL 原样
  });
  it("encode/decode 对称（中文路径——曾因漏 decode 把编码引用写回磁盘）", () => {
    expect(fromVaultUrl(toVaultUrl("assets/示例图片.png"))).toBe("assets/示例图片.png");
    expect(fromVaultUrl(toVaultUrl("工作/读书笔记/截图 v2.png"))).toBe("工作/读书笔记/截图 v2.png");
  });
});

describe("vaultUrlsToRelative（保存时 URL → 笔记相对引用）", () => {
  it("子目录笔记的根资源 → ../ 引用", () => {
    const md = `文字\n\n![](${toVaultUrl("assets/x.png")})\n`;
    expect(vaultUrlsToRelative(md, "工作")).toContain("../assets/x.png");
    expect(vaultUrlsToRelative(md, "工作")).not.toContain("vault://");
  });
  it("根笔记 → 原样相对路径", () => {
    const md = `![](${toVaultUrl("assets/x.png")})`;
    expect(vaultUrlsToRelative(md, "")).toBe("![](assets/x.png)");
  });
  it("外部 URL 不动", () => {
    const md = "![a](https://x.com/y.png) ![b](assets/z.png)";
    expect(vaultUrlsToRelative(md, "a")).toBe(md);
  });
  it("多个图片引用", () => {
    const md = `![](${toVaultUrl("assets/a.png")})\n![](${toVaultUrl("assets/b.png")})`;
    const out = vaultUrlsToRelative(md, "a/b");
    expect(out).toBe("![](../../assets/a.png)\n![](../../assets/b.png)");
  });
});
