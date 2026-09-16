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
    .replace(/^\|[\s\-|]+\|\s*$/gm, (line) => {
      // 表格分隔行 → 规范形式 | --- | --- |
      const cols = line.split("|").slice(1, -1).length;
      return "| " + Array(cols).fill("---").join(" | ") + " |";
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
});
