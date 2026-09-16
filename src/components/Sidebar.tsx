import { useEffect, useState } from "react";
import { useVaultStore } from "../stores/vault";
import { TreeView } from "./TreeView";
import type { PathTitle } from "../lib/vault";

function MetaList({
  items,
  onOpen,
  starred,
}: {
  items: PathTitle[];
  onOpen: (path: string) => void;
  starred?: boolean;
}) {
  return (
    <ul className="space-y-px">
      {items.map((it) => (
        <li key={it.path}>
          <button
            onClick={() => onOpen(it.path)}
            className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800/70"
          >
            <span className="w-4 shrink-0 text-center text-xs opacity-70">
              {starred ? "⭐" : "🕘"}
            </span>
            <span className="min-w-0 flex-1 truncate">{it.title}</span>
          </button>
        </li>
      ))}
      {items.length === 0 && (
        <li className="px-3 py-1 text-xs text-zinc-600">暂无</li>
      )}
    </ul>
  );
}

export function Sidebar() {
  const {
    tree,
    vaultPath,
    searchQuery,
    searchResults,
    recents,
    favorites,
    activePath,
    openNote,
    createNote,
    createFolder,
    doSearch,
    reindex,
  } = useVaultStore();
  const [q, setQ] = useState(searchQuery);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => void doSearch(q), 250);
    return () => clearTimeout(t);
  }, [q, doSearch]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold">
          L
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Lanmark</div>
          <div className="truncate text-[11px] text-zinc-500" title={vaultPath ?? ""}>
            {vaultPath ?? ""}
          </div>
        </div>
        <button
          title="重新扫描 vault（外部改动后点这个）"
          className="rounded px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
          onClick={() => void reindex()}
        >
          ⟳
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-3 pt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 搜索笔记（标题或正文）…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-600"
        />
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-1 pb-4">
        {q.trim() ? (
          /* 搜索结果 */
          <ul className="space-y-1">
            {searchResults.map((r) => (
              <li key={r.path}>
                <button
                  onClick={() => {
                    void openNote(r.path);
                    setQ("");
                    doSearch("");
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-800/70"
                >
                  <div className="truncate text-sm text-zinc-200">{r.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                    {r.snippet || r.path}
                  </div>
                </button>
              </li>
            ))}
            {searchResults.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-zinc-600">
                没有匹配「{q}」的笔记
              </li>
            )}
          </ul>
        ) : (
          <>
            {/* 收藏 */}
            <div className="mb-1 mt-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              ⭐ 收藏
            </div>
            <MetaList items={favorites} starred onOpen={(p) => void openNote(p)} />

            {/* 最近 */}
            <div className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              🕘 最近
            </div>
            <MetaList items={recents} onOpen={(p) => void openNote(p)} />

            {/* 笔记本树 */}
            <div className="mb-1 mt-4 flex items-center justify-between px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                📁 笔记本
              </span>
              <span className="flex gap-1">
                <button
                  title="在根目录新建笔记"
                  className="rounded px-1 text-xs text-zinc-400 hover:bg-zinc-800"
                  onClick={() => void createNote("")}
                >
                  + 笔记
                </button>
                <button
                  title="在根目录新建文件夹"
                  className="rounded px-1 text-xs text-zinc-400 hover:bg-zinc-800"
                  onClick={() => void createFolder("")}
                >
                  + 文件夹
                </button>
              </span>
            </div>
            <TreeView tree={tree} />
          </>
        )}
      </div>

      {activePath && (
        <div className="border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
          当前：{activePath}
        </div>
      )}
    </aside>
  );
}
