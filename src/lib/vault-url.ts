/**
 * vault:// 协议 URL 与相对路径的换算。
 *
 * 约定（与 Obsidian 一致）：markdown 里的图片引用是「相对笔记所在目录」的路径，
 * 例如 工作/笔记.md 里写 ![](assets/x.png) 实际指 工作/assets/x.png。
 * WYSIWYG 文档树内的 image src 则用 vault 绝对协议 URL（vault://localhost/<vault相对路径>），
 * 序列化回 markdown 时把前缀剥掉，恢复为相对引用（源文件零侵入）。
 */

const VAULT_PREFIX = "vault://localhost/";

/** 是否外部/绝对 URL（不需要走 vault 协议） */
export function isExternal(src: string): boolean {
  return (
    /^https?:\/\//i.test(src) ||
    /^data:/i.test(src) ||
    src.startsWith(VAULT_PREFIX) ||
    src.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(src) // Windows 绝对路径
  );
}

/**
 * 把「相对 baseDir 的引用 ref」解析为 vault 相对路径（处理 .. 与 .）。
 * 结果不含 ".."（越出根目录的引用按根目录截断，由协议层 404 兜底）。
 */
export function resolveFrom(baseDir: string, ref: string): string {
  const parts = (baseDir ? baseDir.split("/") : []).concat(ref.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/**
 * 生成 Obsidian 风格的相对引用：从 fromDir 指向 vault 相对路径 toPath。
 * fromDir 与 toPath 同级 → "assets/x.png"；跨级 → "../assets/x.png"。
 */
export function relativeFrom(fromDir: string, toPath: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = toPath.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  return [...Array(ups).fill(".."), ...to.slice(i)].filter(Boolean).join("/");
}

/** vault 相对路径 → 协议 URL（每段 percent-encode，支持中文） */
export function toVaultUrl(vaultRel: string): string {
  return (
    VAULT_PREFIX +
    vaultRel
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/")
  );
}

/**
 * 协议 URL → vault 相对路径（保存前还原用）。
 * 注意必须逐段 percent-decode，与 toVaultUrl 的 encode 对称——
 * 漏掉解码会把编码后的引用写回磁盘（曾导致中文文件名逐次启动叠加编码）。
 */
export function fromVaultUrl(src: string): string {
  if (!src.startsWith(VAULT_PREFIX)) return src;
  return src
    .slice(VAULT_PREFIX.length)
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
}

/**
 * 保存前：markdown 中的 vault 协议 URL → 相对笔记目录的引用（Obsidian 约定）。
 * 例：笔记在 工作/ 下，图在根 assets/ → URL 还原为 ../assets/x.png
 */
export function vaultUrlsToRelative(markdown: string, noteDir: string): string {
  return markdown.replace(/vault:\/\/localhost\/[^\s)"']+/g, (url) => {
    const rel = fromVaultUrl(url);
    return rel ? relativeFrom(noteDir, rel) : url;
  });
}

/** 简单前缀剥离（测试/调试用；产品保存路径请用 vaultUrlsToRelative） */
export function stripVaultPrefix(markdown: string): string {
  return markdown.split(VAULT_PREFIX).join("");
}
