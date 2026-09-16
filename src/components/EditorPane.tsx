import { useEffect, useRef } from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { insertImageCommand } from "@milkdown/kit/preset/commonmark";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

import { useVaultStore } from "../stores/vault";
import { uploadFile } from "../lib/image";

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
    (async () => {
      crepe = new Crepe({
        root: host,
        defaultValue: content,
        features: {
          // 精简：关掉 AI 光标 / 顶栏，保留工具栏（斜杠菜单）、代码块、表格、公式、图片
          [CrepeFeature.AI]: false,
          [CrepeFeature.Cursor]: false,
          [CrepeFeature.TopBar]: false,
          [CrepeFeature.Latex]: true,
          [CrepeFeature.Table]: true,
          [CrepeFeature.CodeMirror]: true,
          [CrepeFeature.ImageBlock]: true,
          [CrepeFeature.Toolbar]: true,
          [CrepeFeature.BlockEdit]: true,
          [CrepeFeature.ListItem]: true,
          [CrepeFeature.LinkTooltip]: true,
          [CrepeFeature.Placeholder]: true,
        },
        featureConfigs: {
          [CrepeFeature.ImageBlock]: {
            onUpload: (file: File) => uploadFile(file),
            inlineOnUpload: (file: File) => uploadFile(file),
            blockOnUpload: (file: File) => uploadFile(file),
          },
        },
      });
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, md) => onChange(md));
      });
      await crepe.create();
      if (cancelled) {
        await crepe?.destroy();
        return;
      }

      // 剪贴板图片粘贴 → 落盘 assets/ → 在光标处插入（Crepe 的 ImageBlock 不处理粘贴）
      const onPaste = async (e: ClipboardEvent) => {
        const files = Array.from(e.clipboardData?.items ?? [])
          .filter((i) => i.kind === "file")
          .map((i) => i.getAsFile())
          .filter((f): f is File => !!f);
        if (files.length === 0 || !crepe) return;
        e.preventDefault();
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
      host.addEventListener("paste", onPaste);
      // 把 onPaste 的清理闭包挂到 host 上，便于 unmount 时移除
      (host as HTMLDivElement & { __lanmarkPaste?: (e: ClipboardEvent) => unknown }).__lanmarkPaste =
        onPaste;
    })();

    return () => {
      cancelled = true;
      const h = host as HTMLDivElement & { __lanmarkPaste?: (e: ClipboardEvent) => unknown };
      if (h.__lanmarkPaste) host.removeEventListener("paste", h.__lanmarkPaste);
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
