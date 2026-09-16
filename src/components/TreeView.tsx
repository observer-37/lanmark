import { useState } from "react";
import { useVaultStore } from "../stores/vault";
import type { VaultNode } from "../lib/vault";

interface Props {
  tree: VaultNode[];
}

/** 目录树：扁平渲染（深度 = 路径段数），hover 显示操作，支持内联重命名 */
export function TreeView({ tree }: Props) {
  const activePath = useVaultStore((s) => s.activePath);
  const favorites = useVaultStore((s) => s.favorites);
  const renamingPath = useVaultStore((s) => s.renamingPath);
  const openNote = useVaultStore((s) => s.openNote);
  const createNote = useVaultStore((s) => s.createNote);
  const createFolder = useVaultStore((s) => s.createFolder);
  const commitRename = useVaultStore((s) => s.commitRename);
  const deleteNode = useVaultStore((s) => s.deleteNode);
  const toggleFavorite = useVaultStore((s) => s.toggleFavorite);
  const setRenaming = useVaultStore((s) => s.setRenaming);
  const [draft, setDraft] = useState("");

  const favSet = new Set(favorites.map((f) => f.path));

  return (
    <ul className="space-y-px">
      {tree.length === 0 && (
        <li className="px-3 py-2 text-xs text-zinc-600">
          库是空的，点下面「+ 笔记」开始
        </li>
      )}
      {tree.map((node) => {
        const depth = node.path.split("/").length - 1;
        const isNote = node.kind === "note";
        const isActive = node.path === activePath;
        const isRenaming = node.path === renamingPath;

        return (
          <li key={node.path} className="group">
            <div
              className={`flex cursor-pointer items-center gap-1 rounded-md pr-1 hover:bg-zinc-800/70 ${
                isActive ? "bg-zinc-800 text-zinc-50" : "text-zinc-300"
              }`}
              style={{ paddingLeft: depth * 14 + 8 }}
              onClick={() => {
                if (isNote && !isRenaming) void openNote(node.path);
              }}
            >
              <span className="w-4 shrink-0 text-center text-xs opacity-70">
                {isNote ? "📄" : "📁"}
              </span>

              {isRenaming ? (
                <input
                  autoFocus
                  value={isNote ? node.name.replace(/\.md$/, "") : node.name}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full min-w-0 rounded border border-emerald-600 bg-zinc-900 px-1 py-0.5 text-sm outline-none"
                  onFocus={(e) => e.target.select()}
                  onBlur={() => {
                    const d = draft.trim();
                    setRenaming(null);
                    if (d) void commitRename(node.path, d);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename(node.path, draft.trim());
                    } else if (e.key === "Escape") {
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">
                  {node.name}
                </span>
              )}

              {!isRenaming && (
                <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                  {isNote && (
                    <>
                      <button
                        title={favSet.has(node.path) ? "取消收藏" : "收藏"}
                        className="rounded px-1 text-xs hover:bg-zinc-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFavorite(node.path);
                        }}
                      >
                        {favSet.has(node.path) ? "⭐" : "☆"}
                      </button>
                      <button
                        title="重命名"
                        className="rounded px-1 text-xs hover:bg-zinc-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraft(isNote ? node.name.replace(/\.md$/, "") : node.name);
                          setRenaming(node.path);
                        }}
                      >
                        ✎
                      </button>
                    </>
                  )}
                  <button
                    title="删除（移入回收站）"
                    className="rounded px-1 text-xs hover:bg-zinc-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteNode(node.path);
                    }}
                  >
                    🗑
                  </button>
                </span>
              )}
            </div>

            {/* 文件夹/笔记行下方的快捷操作（hover 显示） */}
            {!isRenaming && (
              <div
                className="hidden group-hover:flex items-center gap-1 pr-1"
                style={{ paddingLeft: depth * 14 + 26 }}
              >
                <button
                  title="新建笔记"
                  className="rounded px-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    void createNote(node.kind === "folder" ? node.path : "");
                  }}
                >
                  + 笔记
                </button>
                {node.kind === "folder" && (
                  <button
                    title="新建子文件夹"
                    className="rounded px-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      void createFolder(node.path);
                    }}
                  >
                    + 文件夹
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
