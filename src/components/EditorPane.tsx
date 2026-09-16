import { useEffect, useRef } from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { insertImageCommand } from "@milkdown/kit/preset/commonmark";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

import { useVaultStore } from "../stores/vault";
import { uploadFile } from "../lib/image";
import { splitFrontmatter, joinFrontmatter } from "../lib/frontmatter";

/** WYSIWYG 编辑器宿主（Crepe）：切换笔记/模式时整体重建，避免状态残留 */
function MilkdownHost({
  content,
  onChange,
}: {
  content: string;
  onChange: (md: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let crepe: Crepe | null = null;

    host.innerHTML = "";
    // frontmatter 不进编辑器（CommonMark 会破坏 --- ），保存时原样回填
    const { fm, body } = splitFrontmatter(content);
    (async () => {
      crepe = new Crepe({
        root: host,
        defaultValue: body,
        features: {
          // 精简：关掉 AI 光标 / 顶栏，保留工具栏（斜杠菜单）、代码块、表格、公式
          [CrepeFeature.AI]: false,
          [CrepeFeature.Cursor]: false,
          [CrepeFeature.TopBar]: false,
          // ImageBlock 关闭：其序列化会把缩放比例写进 alt（![1.00](…)），
          // 破坏原始 markdown。图片走 commonmark 原生节点：粘贴（insertImageCommand）或手写 ![](...)
          [CrepeFeature.ImageBlock]: false,
          [CrepeFeature.Latex]: true,
          [CrepeFeature.Table]: true,
          [CrepeFeature.CodeMirror]: true,
          [CrepeFeature.Toolbar]: true,
          [CrepeFeature.BlockEdit]: true,
          [CrepeFeature.ListItem]: true,
          [CrepeFeature.LinkTooltip]: true,
          [CrepeFeature.Placeholder]: true,
        },
      });
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, md) => onChange(joinFrontmatter(fm, md)));
      });
      await crepe.create();
      if (cancelled) {
        await crepe?.destroy();
        return;
      }

      // 图片落盘并插入（粘贴 / 拖入共用）
      const insertFiles = async (files: File[]) => {
        if (!crepe) return;
        for (const f of files) {
          try {
            const rel = await uploadFile(f);
            const alt = f.name.replace(/\.[^.]+$/, "");
            insertImageCommand.run({ src: rel, alt });
          } catch (err) {
            void useVaultStore.setState({ error: String(err) });
          }
        }
      };

      // 剪贴板图片粘贴 → 落盘 assets/ → 在光标处插入
      const onPaste = (e: ClipboardEvent) => {
        const files = Array.from(e.clipboardData?.items ?? [])
          .filter((i) => i.kind === "file")
          .map((i) => i.getAsFile())
          .filter((f): f is File => !!f);
        if (files.length === 0) return;
        e.preventDefault();
        void insertFiles(files);
      };

      // 文件拖入（仅拦截图片文件，文本拖拽仍走 ProseMirror 默认行为）
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      };
      const onDrop = (e: DragEvent) => {
        const files = Array.from(e.dataTransfer?.files ?? []).filter(
          (f) => f.type.startsWith("image/") || f.name.match(/\.(png|jpe?g|gif|webp|svg|bmp)$/i),
        );
        if (files.length === 0) return;
        e.preventDefault();
        void insertFiles(files);
      };

      host.addEventListener("paste", onPaste);
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);
      (host as HTMLDivElement & { __lanmarkCleanup?: () => void }).__lanmarkCleanup = () => {
        host.removeEventListener("paste", onPaste);
        host.removeEventListener("dragover", onDragOver);
        host.removeEventListener("drop", onDrop);
      };
    })();

    return () => {
      cancelled = true;
      const h = host as HTMLDivElement & { __lanmarkCleanup?: () => void };
      h.__lanmarkCleanup?.();
      void crepe?.destroy();
      host.innerHTML = "";
    };
    // 仅在笔记切换 / 模式切换时重建（key 由父组件控制）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="editor-host" />;
}

export function EditorPane() {
  const {
    activePath,
    content,
    editorMode,
    dirty,
    savedAt,
    setContent,
    scheduleSave,
    setEditorMode,
    closeNote,
    toggleFavorite,
    favorites,
  } = useVaultStore();

  if (!activePath) {
    return (
      <main className="flex flex-1 items-center justify-center text-zinc-600">
        <div className="text-center">
          <div className="mb-3 text-4xl">📝</div>
          <p className="text-sm">从左侧选择笔记，或点「+ 笔记」新建</p>
          <p className="mt-1 text-xs">
            粘贴图片 / 拖入图片会自动存入 assets/
          </p>
        </div>
      </main>
    );
  }

  const crumbs = activePath.split("/");
  const isFav = favorites.some((f) => f.path === activePath);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <div className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={activePath}>
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 opacity-50">/</span>}
              {c}
            </span>
          ))}
        </div>

        <span
          className={`shrink-0 text-[11px] ${dirty ? "text-amber-400" : "text-zinc-600"}`}
        >
          {dirty
            ? "未保存…"
            : savedAt
              ? `已保存 ${new Date(savedAt).toLocaleTimeString()}`
              : ""}
        </span>

        <button
          title="收藏 / 取消收藏"
          className={`rounded px-1.5 py-0.5 text-sm hover:bg-zinc-800 ${isFav ? "" : "opacity-50"}`}
          onClick={() => void toggleFavorite(activePath)}
        >
          {isFav ? "⭐" : "☆"}
        </button>

        <button
          onClick={() => closeNote()}
          className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-800"
          title="关闭当前笔记"
        >
          ✕
        </button>

        <div className="flex overflow-hidden rounded-lg border border-zinc-700 text-xs">
          <button
            className={`px-2 py-1 ${editorMode === "wysiwyg" ? "bg-emerald-700 text-white" : "text-zinc-400 hover:bg-zinc-800"}`}
            onClick={() => setEditorMode("wysiwyg")}
          >
            所见即所得
          </button>
          <button
            className={`px-2 py-1 ${editorMode === "source" ? "bg-emerald-700 text-white" : "text-zinc-400 hover:bg-zinc-800"}`}
            onClick={() => setEditorMode("source")}
          >
            源码
          </button>
        </div>
      </div>

      {/* 编辑区：key 强制按笔记+模式重建编辑器 */}
      <div className="min-h-0 flex-1">
        {editorMode === "wysiwyg" ? (
          <MilkdownHost
            key={`${activePath}|wysiwyg`}
            content={content}
            onChange={(md) => {
              setContent(md);
              scheduleSave();
            }}
          />
        ) : (
          <CodeMirror
            key={`${activePath}|source`}
            value={content}
            height="100%"
            style={{ height: "100%" }}
            extensions={[markdown()]}
            onChange={(value) => {
              setContent(value);
              scheduleSave();
            }}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        )}
      </div>
    </main>
  );
}
