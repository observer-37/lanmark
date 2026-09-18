/**
 * frontmatter 分离/回填测试（AGENTS.md 布局表声称存在，此前实际缺失）。
 * 往返保真关键：fm 不进 WYSIWYG 编辑器，保存时原样回填。
 */
import { describe, it, expect } from "vitest";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("基本块 + 正文", () => {
    const { fm, body } = splitFrontmatter("---\ntitle: x\ntags: [a]\n---\n正文");
    expect(fm).toBe("---\ntitle: x\ntags: [a]\n---");
    expect(body).toBe("正文");
  });

  it("首行不是 --- → 无 frontmatter", () => {
    const { fm, body } = splitFrontmatter("# 标题\n\n正文");
    expect(fm).toBe("");
    expect(body).toBe("# 标题\n\n正文");
  });

  it("未闭合 frontmatter → 整体当正文（不拆）", () => {
    const md = "---\ntitle: x\n但没有闭合\n正文";
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("");
    expect(body).toBe(md);
  });

  it("... 作为 YAML 文档结束符同样闭合", () => {
    const { fm, body } = splitFrontmatter("---\ntitle: x\n...\n正文");
    expect(fm).toBe("---\ntitle: x\n...");
    expect(body).toBe("正文");
  });

  it("--- 后多个空行被消耗（已知行为：join 只回一个换行）", () => {
    const { body } = splitFrontmatter("---\ntitle: x\n---\n\n\n正文");
    expect(body).toBe("正文");
    // 该损耗只发生在 WYSIWYG 真实编辑保存后（正文反正被重序列化）；
    // 源码模式 / 未编辑打开不受影响
  });

  it("仅 frontmatter 无正文", () => {
    const { fm, body } = splitFrontmatter("---\ntitle: x\n---");
    expect(fm).toBe("---\ntitle: x\n---");
    expect(body).toBe("");
  });

  it("首行前导空白被 trim 接受", () => {
    const { fm, body } = splitFrontmatter("  ---\ntitle: x\n---\n正文");
    expect(fm.endsWith("---")).toBe(true);
    expect(body).toBe("正文");
  });

  it("CRLF 文件：fm 的 \\r 随原始行保留（字节保真）", () => {
    // 闭合行 "---\r" 的 \\r 属于该行使其留在 fm 内；join 后字节复原
    const { fm, body } = splitFrontmatter("---\r\ntitle: x\r\n---\r\n正文\r\n");
    expect(fm).toBe("---\r\ntitle: x\r\n---\r");
    expect(body).toBe("正文\r\n");
    expect(joinFrontmatter(fm, body)).toBe("---\r\ntitle: x\r\n---\r\n正文\r\n");
  });

  it("BOM 前缀：trim 接受 BOM+---，BOM 字节留在 fm 内", () => {
    const { fm, body } = splitFrontmatter("\uFEFF---\ntitle: x\n---\n正文");
    expect(fm).toBe("\uFEFF---\ntitle: x\n---");
    expect(body).toBe("正文");
  });

  it("join(split(x)) 标准形态往返不变", () => {
    const md = "---\ntitle: x\n---\n正文";
    const s = splitFrontmatter(md);
    expect(joinFrontmatter(s.fm, s.body)).toBe(md);
  });
});

describe("joinFrontmatter", () => {
  it("无 fm → 原样返回正文", () => {
    expect(joinFrontmatter("", "正文")).toBe("正文");
  });

  it("有 fm → fm + 换行 + 正文", () => {
    expect(joinFrontmatter("---\nt: x\n---", "正文")).toBe("---\nt: x\n---\n正文");
  });
});
