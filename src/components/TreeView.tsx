import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { useVaultStore } from "../stores/vault";
import type { VaultNode } from "../lib/vault";

interface Props {
  tree: VaultNode[];
}

/* 文件夹彩色编码：按顶层目录名散列取色（绿/琥珀/蓝循环），承载「这是哪个分区」的信息 */
const FOLDER_HUES = ["var(--c-fd-1)", "var(--c-fd-2)", "var(--c-fd-3)"];
function folderHue(path: string): string {
  const root = path.split("/")[0];
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) >>> 0;
  return FOLDER_HUES[h % FOLDER_HUES.length];
}

/**
 * 内联重命名输入框。
 * 必须是有自己 state 的独立组件：value 绑定本组件 draft（实时显示输入）。
 * 曾踩坑：value 绑 node.name 而 onChange 写父级 draft → 每次击键被重置回原名，
 * 输入「不显示」直到 Enter 提交后才变化。
 */
function RenameInput({
  path,
  initial,
  onCommit,
  onCancel,
}: {
  path: string;
  initial: string;
  onCommit: (path: string, name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const commit = () => {
    const d = draft.trim();
    if (d) onCommit(path, d);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded-md border border-accent bg-card px-1.5 py-0.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20"
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
    />
  );
}

/** 右键菜单项（C 风格：图标 + 文字，白卡浮层） */
function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: typeof Star;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-canvas ${
        danger ? "text-red-600" : "text-ink"
      }`}
      onClick={onClick}
    >
      <Icon size={14} className={danger ? "text-red-500" : "text-ink-3"} />
      {label}
    </button>
  );
}

/** 目录树：扁平渲染（深度 = 路径段数），hover 显示操作，支持内联重命名与右键菜单 */
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

  const favSet = new Set(favorites.map((f) => f.path));

  // 右键上下文菜单（VSCode 式：新建入口在分区标题，行级操作在菜单里）
  const [menu, setMenu] = useState<{ x: number; y: number; node: VaultNode } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    // 捕获阶段监听：点菜单外任意处（含其它行）先关菜单
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, node: VaultNode) => {
    e.preventDefault();
    // 视口内收口，避免菜单贴边溢出
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 190));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 260));
    setMenu({ x, y, node });
  };

  const closeAnd = (fn: () => void) => {
    setMenu(null);
    fn();
  };

  return (
    <>
    <ul className="space-y-0.5">
      {tree.length === 0 && (
        <li className="px-3 py-2 text-xs text-ink-3">
          库是空的，点上方「+ 笔记」开始，或右键文件夹新建
        </li>
      )}
      {tree.map((node) => {
        const depth = node.path.split("/").length - 1;
        const isNote = node.kind === "note";
        const isActive = node.path === activePath;
        const isRenaming = node.path === renamingPath;
        const isFav = favSet.has(node.path);

        return (
          <li key={node.path} className="group">
            <div
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-1 hover:bg-canvas ${
                isActive
                  ? "bg-accent-soft font-medium text-accent-text"
                  : "text-ink"
              }`}
              style={{ paddingLeft: depth * 14 + 8 }}
              onClick={() => {
                if (isNote && !isRenaming) void openNote(node.path);
              }}
              onContextMenu={(e) => openMenu(e, node)}
            >
              {isNote ? (
                <FileText size={14} className="shrink-0 text-ink-3" />
              ) : (
                <Folder size={15} className="shrink-0" style={{ color: folderHue(node.path) }} />
              )}

              {isRenaming ? (
                <RenameInput
                  key={`rename-${node.path}`}
                  path={node.path}
                  initial={isNote ? node.name.replace(/\.md$/, "") : node.name}
                  onCommit={(p, name) => void commitRename(p, name)}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
              )}

              {!isRenaming && (
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  {isNote && (
                    <>
                      <button
                        title={isFav ? "取消收藏" : "收藏"}
                        className="rounded-md p-1 hover:bg-line/60"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFavorite(node.path);
                        }}
                      >
                        <Star
                          size={13}
                          className={isFav ? "fill-amber-400 text-amber-400" : "text-ink-3"}
                        />
                      </button>
                      <button
                        title="重命名"
                        className="rounded-md p-1 hover:bg-line/60"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming(node.path);
                        }}
                      >
                        <Pencil size={13} className="text-ink-3" />
                      </button>
                    </>
                  )}
                  <button
                    title="删除（移入回收站）"
                    className="rounded-md p-1 hover:bg-line/60"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteNode(node.path);
                    }}
                  >
                    <Trash2 size={13} className="text-ink-3 hover:text-red-500" />
                  </button>
                </span>
              )}
            </div>
          </li>
        );
      })}
      </ul>

      {/* 右键上下文菜单（VSCode 式：文件夹可新建子项，行级操作集中在此） */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[11rem] rounded-xl border border-line bg-card py-1 shadow-pop"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.node.kind === "folder" && (
            <>
              <MenuItem
                icon={FileText}
                label="新建笔记"
                onClick={() => closeAnd(() => void createNote(menu.node.path))}
              />
              <MenuItem
                icon={FolderPlus}
                label="新建文件夹"
                onClick={() => closeAnd(() => void createFolder(menu.node.path))}
              />
              <div className="my-1 h-px bg-line" />
            </>
          )}
          <MenuItem
            icon={Pencil}
            label="重命名"
            onClick={() => closeAnd(() => setRenaming(menu.node.path))}
          />
          {menu.node.kind === "note" && (
            <MenuItem
              icon={Star}
              label={favSet.has(menu.node.path) ? "取消收藏" : "收藏"}
              onClick={() => closeAnd(() => void toggleFavorite(menu.node.path))}
            />
          )}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={Trash2}
            label="删除（移入回收站）"
            danger
            onClick={() => closeAnd(() => void deleteNode(menu.node.path))}
          />
        </div>
      )}
    </>
  );
}
