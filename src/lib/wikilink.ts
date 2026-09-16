/**
 * Obsidian wikilink 保护/还原（与 frontmatter 同模式）。
 *
 * 背景：CommonMark 把 `[[x]]` 当链接候选，Milkdown 序列化时转义首括号（`\[\[x]]`），
 * 文字不丢但 Obsidian 的 wikilink 语义被破坏（变死链）。
 * 方案：进编辑器前替换为 ⟦x⟧（普通 Unicode，commonmark 无法链接化），
 * 保存时按 map 精确还原——源文件字节级不变。
 *
 * 显示代价：WYSIWYG 中 wikilink 显示为 ⟦x⟧ / ⟦!x⟧（嵌入带 ! 前缀）；源码模式不受影响。
 * 已知边界：用户正文里恰好手写 ⟦⟧ 且 key 与同文件 wikilink 内文相同时会误还原（极罕见）。
 */

export function protectWikilinks(md: string): { body: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  const body = md.replace(/!?\[\[[^\[\]]+\]\]/g, (m) => {
    const inner = m.slice(m.startsWith("!") ? 3 : 2, -2);
    const key = (m.startsWith("!") ? "!" : "") + inner;
    if (!map.has(key)) map.set(key, m);
    return "⟦" + key + "⟧";
  });
  return { body, map };
}

export function restoreWikilinks(md: string, map: Map<string, string>): string {
  if (map.size === 0) return md;
  return md.replace(/⟦([^\⟧]+)⟧/g, (m, key) => map.get(key) ?? m);
}
