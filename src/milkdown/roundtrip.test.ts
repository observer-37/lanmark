/**
 * M1 决策门自动化证据：markdown ↔ Crepe(ProseMirror) ↔ markdown 往返保真。
 * 编辑器配置与产品（EditorPane.tsx）保持一致。
 *
 * 保真标准（docs/04）：
 *  - 结构无损：标题/列表/表格/代码块/图片/中文 语义完全保留
 *  - frontmatter 不损坏（走 splitFrontmatter/joinFrontmatter，与产品一致）
 *  - 允许的风格归一化：列表符号 - 与 *、表格分隔行 --- 与 --、hr 三种写法（语义等价）
 *
 * 跑法：pnpm test
 */
import { describe, it, expect } from "vitest";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { splitFrontmatter, joinFrontmatter } from "../lib/frontmatter";
import { protectWikilinks, restoreWikilinks } from "../lib/wikilink";

/** 与 EditorPane 一致的产品 feature 配置 */
const PRODUCT_FEATURES = {
  [CrepeFeature.AI]: false,
  [CrepeFeature.Cursor]: false,
  [CrepeFeature.TopBar]: false,
  [CrepeFeature.ImageBlock]: false, // 关闭：其序列化会破坏 alt（见 EditorPane 注释）
  [CrepeFeature.Latex]: true,
  [CrepeFeature.Table]: true,
  [CrepeFeature.CodeMirror]: true,
  [CrepeFeature.Toolbar]: true,
  [CrepeFeature.BlockEdit]: true,
  [CrepeFeature.ListItem]: true,
  [CrepeFeature.LinkTooltip]: true,
  [CrepeFeature.Placeholder]: true,
} as const;

function normalize(md: string): string {
  return md.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/**
 * 语义等价归一化：统一列表符号、表格分隔行、hr 风格。
 * 只动「纯风格」，不动任何文字内容。
 */
function semantic(md: string): string {
  return normalize(md)
    .replace(/^( *)\* /gm, "$1- ") // 行首无序列表符号 * → -
    .replace(/^[*_]{3,}\s*$/gm, "---") // hr: *** / ___ → ---
    .replace(/^\|.*\|\s*$/gm, (line) => {
      // 表格行：单元格统一 trim（消除列宽填充），分隔行 ---/-- 归一
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => {
          const t = c.trim();
          return /^-+$/.test(t) ? "---" : t;
        });
      return "| " + cells.join(" | ") + " |";
    });
}

/** 用产品配置构建一次编辑器，往返一次，返回序列化结果 */
async function roundtrip(input: string): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const crepe = new Crepe({
    root,
    defaultValue: input,
    features: PRODUCT_FEATURES,
  });
  await crepe.create();
  const out = crepe.getMarkdown();
  await crepe.destroy();
  root.remove();
  return out;
}

describe("Milkdown 往返保真（M1 决策门）", () => {
  it("基础 markdown：标题/强调/代码/链接/引用/列表/hr", async () => {
    const md = [
      "# 一级标题",
      "",
      "## 二级标题",
      "",
      "**加粗** *斜体* ~~删除线~~ `行内代码`",
      "",
      "[链接](https://example.com/x)",
      "",
      "- 无序一",
      "- 无序二",
      "  - 嵌套项",
      "",
      "1. 有序一",
      "2. 有序二",
      "",
      "> 引用段落",
      "",
      "---",
      "",
      "普通段落。",
    ].join("\n");
    const out = await roundtrip(md);
    expect(semantic(out)).toBe(semantic(md));
  });

  it("代码块（带语言标记，内容含 markdown 符号不被解析）", async () => {
    const md = ["# 代码", "", "```rust", 'fn main() {', "    let x = \"**bold**\";", "}", "```", "", "尾部文字。"].join("\n");
    const out = await roundtrip(md);
    expect(normalize(out)).toBe(normalize(md));
  });

  it("任务列表（- [ ] / - [x]——§9c 事故触发形态，此前护栏缺 case）", async () => {
    const md = ["# 待办", "", "- [ ] 未完成项", "- [x] 已完成项", "", "普通列表：", "- 普通项一", "- 普通项二"].join("\n");
    const out = await roundtrip(md);
    expect(semantic(out)).toBe(semantic(md));
    // 勾选状态不得丢失
    expect(out).toContain("[x]");
    expect(out).toMatch(/\[\s\]/);
  });

  it("Latex 行内公式 $…$ 字节级往返（产品开启 CrepeFeature.Latex）", async () => {
    const md = ["# 数学", "", "行内公式 $E = mc^2$ 在此。", "", "结尾。"].join("\n");
    const out = await roundtrip(md);
    expect(normalize(out)).toBe(normalize(md));
  });

  it("Latex 显示公式 $$…$$：内容保留，但被降级为行内 $…$（已知上游限制）", async () => {
    // 已知限制（Crepe 上游，非本项目代码）：块公式经 WYSIWYG 保存后
    // 丢失 display 区分，$$…$$ → $…$（公式内容完整保留，仅渲染从居中块变行内）。
    // 根因：Crepe 的 latex 序列化路径未保留 display 标志（block-latex.ts
    // addNode('math',…)）。候选修复：pnpm patch @milkdown/crepe，需真机验证
    // 编辑器 KaTeX 预览后跟进；在此之前用本用例钉住现状防止行为漂移。
    const md = ["# 数学", "", "显示公式：", "", "$$\\int_0^1 x\\,dx = \\frac{1}{2}$$", "", "结尾。"].join("\n");
    const out = await roundtrip(md);
    expect(normalize(out)).toBe(normalize("# 数学\n\n显示公式：\n\n$\\int_0^1 x\\,dx = \\frac{1}{2}$\n\n结尾。"));
  });

  it("GFM 表格", async () => {
    const md = [
      "# 表格",
      "",
      "| 姓名 | 部门 |",
      "| --- | --- |",
      "| 张三 | 研发 |",
      "| 李四 | 产品 |",
    ].join("\n");
    const out = await roundtrip(md);
    expect(semantic(out)).toBe(semantic(md));
  });

  it("中文正文 + 图片引用（assets 相对路径，alt 必须原样保留）", async () => {
    const md = ["# 中文笔记", "", "这是关于 读书笔记 的正文，含中文标点。", "", "![读书截图](assets/a3f8.png)", "", "图片说明文字。"].join("\n");
    const out = await roundtrip(md);
    expect(normalize(out)).toBe(normalize(md));
  });

  it("无 alt 的图片保持无 alt（不被写入 1.00 之类的伪 alt）", async () => {
    const md = ["# 图片", "", "![](assets/bb11.png)", "", "结尾。"].join("\n");
    const out = await roundtrip(md);
    expect(out).not.toContain("![1.00]");
    expect(normalize(out)).toBe(normalize(md));
  });

  it("frontmatter 经产品流程（分离→编辑→回填）不损坏", async () => {
    const md = ["---", "title: 我的标题", "tags: [a, b]", "---", "", "# 正文标题", "", "正文内容。"].join("\n");
    // 与 EditorPane 相同的处理：frontmatter 不进编辑器
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("---\ntitle: 我的标题\ntags: [a, b]\n---");
    const outBody = await roundtrip(body);
    const out = joinFrontmatter(fm, outBody);
    expect(normalize(out)).toBe(normalize(md));
  });

  it("无 frontmatter 的笔记 split 不受影响", async () => {
    const md = "# 普通笔记\n\n正文。";
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("");
    expect(body).toBe(md);
  });

  it("长文档（1500 行混合内容）往返不丢失结构", async () => {
    const parts: string[] = ["# 长文档", ""];
    for (let i = 0; i < 500; i++) {
      parts.push(`## 第 ${i} 节`, "", `这是第 ${i} 节的正文，含 **加粗** 与 \`代码\`。`, "", `- 要点 ${i}`, `  - 子要点 ${i}`, "");
      if (i % 50 === 0) {
        parts.push("| 列A | 列B |", "| --- | --- |", `| 值${i} | x |`, "");
      }
    }
    const md = parts.join("\n");
    expect(md.split("\n").length).toBeGreaterThan(1500);

    const t0 = Date.now();
    const out = await roundtrip(md);
    const ms = Date.now() - t0;

    expect(semantic(out)).toBe(semantic(md));
    // 性能护栏：1500 行往返应在合理时间内完成
    expect(ms).toBeLessThan(15000);
  });

  it("Obsidian wikilink / 嵌入经产品流程（保护→编辑→还原）字节级不变", async () => {
    const md = ["参见 [[另一篇笔记]] 与 ![[嵌入块]]，以及 [[a|别名]]。", "", "普通 **加粗** 文本。"].join("\n") + "\n"; // 真实文件以 \n 结尾
    const { body, map } = protectWikilinks(md);
    const out = restoreWikilinks(await roundtrip(body), map);
    expect(out).toBe(md); // 字节级还原（含 ![[嵌入]]、[[a|别名]]）
    expect(out).not.toContain("⟦"); // 占位符不得泄漏到输出
  });

  it("insertImageCommand 插入可序列化（粘贴链最后一段：命令 → 文档 → md）", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new Crepe({
      root,
      defaultValue: "# 标题\n\n正文。",
      features: PRODUCT_FEATURES,
    });
    await crepe.create();
    const { insertImageCommand } = await import("@milkdown/kit/preset/commonmark");
    insertImageCommand.run({ src: "vault://localhost/assets/x.png", alt: "测试图" });
    const md = crepe.getMarkdown();
    expect(md).toContain("![测试图](vault://localhost/assets/x.png)"); // alt 原样保留
    expect(md).not.toContain("1.00"); // ImageBlock 已关闭：不得出现比例伪 alt
    await crepe.destroy();
    root.remove();
  });
});
