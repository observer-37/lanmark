import { FolderOpen, FolderPlus } from "lucide-react";
import { useVaultStore } from "../stores/vault";

export function VaultPicker() {
  const pickVault = useVaultStore((s) => s.pickVault);
  const error = useVaultStore((s) => s.error);
  const clearError = useVaultStore((s) => s.clearError);

  return (
    <div className="flex h-screen items-center justify-center bg-canvas text-ink">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-white shadow-slider">
          L
        </div>
        <h1 className="text-xl font-semibold">Lanmark</h1>
        <p className="mt-2 text-sm text-ink-2">
          选择一个目录作为你的笔记库（vault）。
          <br />
          所有笔记都是纯 Markdown 文件，随时可以用 Obsidian 打开。
        </p>
        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {error}
          </p>
        )}
        <div className="mt-6 space-y-2">
          <button
            onClick={() => {
              clearError();
              void pickVault("create");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-slider hover:bg-accent-text"
          >
            <FolderPlus size={16} />
            创建新笔记库…
          </button>
          <button
            onClick={() => {
              clearError();
              void pickVault("open");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas"
          >
            <FolderOpen size={16} />
            打开现有笔记库…
          </button>
        </div>
        <p className="mt-4 text-xs text-ink-3">
          「创建」选择空目录，「打开」选择已有 .md 笔记的目录
        </p>
      </div>
    </div>
  );
}
