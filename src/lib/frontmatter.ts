/**
 * YAML frontmatter 的分离与回填。
 * WYSIWYG 模式打开笔记时，frontmatter 不能进编辑器
 * （CommonMark 会把 `---` 解析为 hr / setext 标题下划线，导致损坏），
 * 保存时原样回填。源码模式显示全文，可直接编辑 frontmatter。
 */
export interface SplitFrontmatter {
  /** 原始 frontmatter 块（含首尾 `---` 行）；无则空串 */
  fm: string;
  /** frontmatter 之后的正文 */
  body: string;
}

export function splitFrontmatter(md: string): SplitFrontmatter {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { fm: "", body: md };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]?.trim();
    if (t === "---" || t === "...") {
      const fm = lines.slice(0, i + 1).join("\n");
      const body = lines
        .slice(i + 1)
        .join("\n")
        .replace(/^\n+/, "");
      return { fm, body };
    }
  }
  // 未闭合的 frontmatter：按普通文本处理，不拆
  return { fm: "", body: md };
}

export function joinFrontmatter(fm: string, body: string): string {
  if (!fm) return body;
  return `${fm}\n${body}`;
}
