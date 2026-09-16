import { useVaultStore } from "../stores/vault";

export function VaultPicker() {
  const pickVault = useVaultStore((s) => s.pickVault);
  const error = useVaultStore((s) => s.error);
  const clearError = useVaultStore((s) => s.clearError);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold">
          L
        </div>
        <h1 className="text-xl font-bold">Lanmark</h1>
        <p className="mt-2 text-sm text-zinc-400">
          选择一个目录作为你的笔记库（vault）。
          <br />
          所有笔记都是纯 Markdown 文件，随时可以用 Obsidian 打开。
        </p>
        {error && (
          <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 p-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="mt-6 space-y-2">
          <button
            onClick={() => {
              clearError();
              void pickVault("create");
            }}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium hover:bg-emerald-500"
          >
            📂 创建新笔记库…
          </button>
          <button
            onClick={() => {
              clearError();
              void pickVault("open");
            }}
            className="w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium hover:bg-zinc-700"
          >
            📁 打开现有笔记库…
          </button>
        </div>
        <p className="mt-4 text-xs text-zinc-600">
          「创建」选择空目录，「打开」选择已有 .md 笔记的目录
        </p>
      </div>
    </div>
  );
}
