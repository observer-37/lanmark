import { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, ShieldCheck } from "lucide-react";
import { useVaultStore } from "../stores/vault";
import { useSyncStore } from "../stores/sync";
import { isAndroid } from "../lib/sync";

/**
 * 首启选库。桌面走系统文件夹选择器；
 * Android（M2）：SAF 选择器需要「所有文件访问」授权（scoped storage 下
 * SAF 树 URI 无法映射为 std::fs 可写路径，见 docs/research/android-vault-dir.md），
 * 未授权时引导去系统设置，并始终保留「应用目录」免授权回退。
 */
export function VaultPicker() {
  const pickVault = useVaultStore((s) => s.pickVault);
  const pickAndroidFolder = useVaultStore((s) => s.pickAndroidFolder);
  const pickAppDir = useVaultStore((s) => s.pickAppDir);
  const error = useVaultStore((s) => s.error);
  const clearError = useVaultStore((s) => s.clearError);
  const hasAllFilesAccess = useSyncStore((s) => s.hasAllFilesAccess);
  const checkAllFilesAccess = useSyncStore((s) => s.checkAllFilesAccess);
  const requestAllFilesAccess = useSyncStore((s) => s.requestAllFilesAccess);
  const [android] = useState(isAndroid());
  const [permKnown, setPermKnown] = useState(!android);

  useEffect(() => {
    if (android) {
      void checkAllFilesAccess().finally(() => setPermKnown(true));
    }
  }, [android, checkAllFilesAccess]);

  // 从设置页返回时复查授权（页面 visibility 变化）
  useEffect(() => {
    if (!android) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkAllFilesAccess();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [android, checkAllFilesAccess]);

  const needsGrant = android && !hasAllFilesAccess;

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
          {android && needsGrant && (
            <button
              onClick={() => {
                clearError();
                void requestAllFilesAccess();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600"
            >
              <ShieldCheck size={16} />
              授权「所有文件访问」（选手机目录需要）
            </button>
          )}

          <button
            disabled={!permKnown}
            onClick={() => {
              clearError();
              void (android ? pickAndroidFolder("create") : pickVault("create"));
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-slider hover:bg-accent-text disabled:opacity-50"
          >
            <FolderPlus size={16} />
            创建新笔记库…
          </button>
          <button
            disabled={!permKnown}
            onClick={() => {
              clearError();
              void (android ? pickAndroidFolder("open") : pickVault("open"));
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            <FolderOpen size={16} />
            打开现有笔记库…
          </button>
          {android && (
            <button
              onClick={() => {
                clearError();
                void pickAppDir("open");
              }}
              className="w-full rounded-[10px] px-4 py-2 text-xs text-ink-3 hover:text-ink"
            >
              使用应用目录（免授权，笔记不与其他应用共享）
            </button>
          )}
        </div>
        <p className="mt-4 text-xs text-ink-3">
          「创建」选择空目录，「打开」选择已有 .md 笔记的目录
        </p>
      </div>
    </div>
  );
}
