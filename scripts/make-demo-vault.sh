#!/usr/bin/env bash
# 生成 Lanmark 演示 vault，供 M1 验收使用（中文目录/笔记、图片、frontmatter、表格）。
# 用法: scripts/make-demo-vault.sh [目标目录]   （默认 ~/lanmark-demo-vault）
set -e

TARGET="${1:-$HOME/lanmark-demo-vault}"

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "目标已存在且非空: $TARGET（换路径或先清空）" >&2
  exit 1
fi

mkdir -p "$TARGET/工作" "$TARGET/生活" "$TARGET/assets"

# 生成一张 160x80 渐变 PNG（纯标准库，无依赖）
python3 - "$TARGET/assets/示例图片.png" <<'PY'
import struct, sys, zlib
w, h = 160, 80
rows = b""
for y in range(h):
    rows += b"\x00" + bytes(c for x in range(w) for c in (x * 255 // w, y * 255 // h, 120))
def chunk(t, d):
    c = t + d
    return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(rows))
png += chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
print("已生成 assets/示例图片.png")
PY

cat > "$TARGET/欢迎使用 Lanmark.md" <<'EOF'
---
title: 欢迎使用 Lanmark
---
# 欢迎使用 Lanmark

这个演示库用于 M1 验收。建议按以下顺序走一遍：

1. **搜索**：左侧搜索框输入「异步」或「验收」，应命中本笔记
2. **图片**：打开「生活/读书笔记」，能看到 `assets/示例图片.png` 正常显示
3. **新建**：侧栏「+ 笔记」建一个中文命名笔记，重命名（✎）、收藏（⭐）
4. **删除**：删掉任意笔记，去 vault 的 `.lanmark/trash/` 确认文件在回收站
5. **frontmatter**：本笔记开头有 `title:` 块，WYSIWYG 编辑保存后应原样保留
6. **Obsidian**：用 Obsidian 打开同一个目录，确认笔记/图片/结构正常

> 验收完成后，这个目录可以整个删掉。
EOF

cat > "$TARGET/工作/会议纪要-产品周会.md" <<'EOF'
---
title: 产品周会纪要
tags: [工作, 会议]
---
# 产品周会纪要

## 决议

1. 同步方案定为「手机为中心节点」
2. MVP 不含标签/双链

## 待办

- [ ] 完成 M1 验收
- [ ] 准备 M2 真机环境
EOF

cat > "$TARGET/工作/会议纪要-技术评审.md" <<'EOF'
# 技术评审纪要

| 模块 | 风险 | 结论 |
| --- | --- | --- |
| 编辑器往返保真 | 中 | 有自动化测试兜底 |
| Android 后台存活 | 高 | M2 重点验证 |

```rust
// 示例代码块
fn main() { println!("技术评审"); }
```
EOF

cat > "$TARGET/生活/读书笔记.md" <<'EOF'
---
title: 读书笔记
---
# 读书笔记

关于 Rust 异步 的思考：tokio 的执行模型、select! 的取消语义……

![示例图片](../assets/示例图片.png)

图片引用是相对本目录的 `../assets/`，Obsidian 同样能解析。
EOF

echo ""
echo "演示 vault 已生成: $TARGET"
echo "在 Lanmark 首启页选「打开现有笔记库」指向该目录即可。"
