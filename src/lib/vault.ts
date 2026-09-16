import { invoke } from "@tauri-apps/api/core";

export interface VaultNode {
  path: string;
  kind: "note" | "folder";
  name: string;
  title: string | null;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface NoteContent {
  content: string;
  title: string;
}

export interface VaultStatus {
  configured: boolean;
  open: boolean;
  path: string | null;
}

export interface PathTitle {
  path: string;
  title: string;
}

export const vault = {
  status: () => invoke<VaultStatus>("vault_status"),
  pickAndSet: (mode: "open" | "create") =>
    invoke<string>("vault_pick_and_set", { mode }),
  openPath: (path: string) => invoke<string>("vault_open_path", { path }),
  reindex: () => invoke<number>("reindex_vault"),
  tree: () => invoke<VaultNode[]>("tree_list"),
  createNote: (dir: string, name: string) =>
    invoke<VaultNode>("note_create", { dir, name }),
  createFolder: (dir: string, name: string) =>
    invoke<VaultNode>("folder_create", { dir, name }),
  rename: (path: string, newName: string) =>
    invoke<string>("entry_rename", { path, newName }),
  move: (path: string, newDir: string) =>
    invoke<string>("entry_move", { path, newDir }),
  remove: (path: string) => invoke<string>("entry_delete", { path }),
  readNote: (path: string) => invoke<NoteContent>("note_read", { path }),
  writeNote: (path: string, content: string) =>
    invoke<{ mtimeMs: number; hash: string }>("note_write", { path, content }),
  search: (query: string) => invoke<SearchHit[]>("search", { query }),
  recents: () => invoke<[string, string][]>("recents_list"),
  favorites: () => invoke<[string, string][]>("favorites_list"),
  toggleFavorite: (path: string) =>
    invoke<boolean>("favorite_toggle", { path }),
  saveAsset: (dataBase64: string, ext: string) =>
    invoke<string>("asset_save", { dataBase64, ext }),
};

/** vault 内父目录（空串 = 根） */
export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** 把「文件夹被改名/移动」后的子路径重映射 */
export function remapPath(
  p: string | null,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  if (!p) return p;
  if (p === oldPrefix) return newPrefix;
  if (p.startsWith(oldPrefix + "/")) return newPrefix + p.slice(oldPrefix.length);
  return p;
}
