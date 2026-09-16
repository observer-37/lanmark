import { useEffect } from "react";
import { useVaultStore } from "./stores/vault";
import { VaultPicker } from "./components/VaultPicker";
import { Sidebar } from "./components/Sidebar";
import { EditorPane } from "./components/EditorPane";

function Toast() {
  const error = useVaultStore((s) => s.error);
  const clearError = useVaultStore((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  if (!error) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-red-900 bg-red-950/95 p-3 text-sm text-red-200 shadow-xl">
      <div className="flex items-start gap-2">
        <span>⚠️</span>
        <span className="min-w-0 break-all">{error}</span>
        <button className="ml-auto shrink-0 text-red-400 hover:text-red-200" onClick={clearError}>
          ✕
        </button>
      </div>
    </div>
  );
}

function App() {
  const status = useVaultStore((s) => s.status);

  useEffect(() => {
    void useVaultStore.getState().init();
    // 窗口关闭前尽力落盘（best effort）
    const flush = () => void useVaultStore.getState().saveNow();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">
        <div className="text-sm">正在打开笔记库…</div>
      </div>
    );
  }

  if (status === "unconfigured") {
    return (
      <>
        <VaultPicker />
        <Toast />
      </>
    );
  }

  return (
    <>
      <div className="flex h-screen bg-zinc-950 text-zinc-100">
        <Sidebar />
        <EditorPane />
      </div>
      <Toast />
    </>
  );
}

export default App;
