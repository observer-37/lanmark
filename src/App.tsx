import { useEffect } from "react";
import { TriangleAlert, X } from "lucide-react";
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
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-red-200 bg-card p-3 text-sm text-red-600 shadow-pop">
      <div className="flex items-start gap-2">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-red-500" />
        <span className="min-w-0 break-all">{error}</span>
        <button
          className="ml-auto shrink-0 p-0.5 text-ink-3 hover:text-ink"
          onClick={clearError}
        >
          <X size={14} />
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
      <div className="flex h-screen items-center justify-center bg-canvas text-ink-2">
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
      <div className="flex h-screen bg-canvas text-ink">
        <Sidebar />
        <EditorPane />
      </div>
      <Toast />
    </>
  );
}

export default App;
