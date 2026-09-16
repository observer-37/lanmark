import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { greet, ping, ECHO_EVENT, type EchoPayload } from "./lib/bridge";
import { useBridgeStore } from "./stores/bridge";

function App() {
  const [appVersion, setAppVersion] = useState<string>("");
  const [name, setName] = useState("");
  const [greetMsg, setGreetMsg] = useState("");
  const [message, setMessage] = useState("");
  const [pingResult, setPingResult] = useState<EchoPayload | null>(null);
  const [error, setError] = useState("");
  const echoLog = useBridgeStore((s) => s.echoLog);
  const pushEcho = useBridgeStore((s) => s.pushEcho);

  // Rust → 前端：监听事件回推通道
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<EchoPayload>(ECHO_EVENT, (event) => {
      pushEcho({
        message: event.payload.message,
        at: new Date(event.payload.receivedAtUnixMs).toLocaleTimeString(),
      });
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [pushEcho]);

  // App 版本号（来自 tauri.conf.json）
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("web 模式"));
  }, []);

  async function onGreet(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setGreetMsg(await greet(name));
    } catch (err) {
      setError(String(err));
    }
  }

  async function onPing(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await ping(message);
      setPingResult(result);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* 侧栏：产品骨架占位 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-800 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 font-bold">
            L
          </div>
          <div>
            <div className="font-semibold">Lanmark</div>
            <div className="text-xs text-zinc-500">v{appVersion || "…"}</div>
          </div>
        </div>
        <nav className="space-y-1 text-sm text-zinc-500">
          <div className="cursor-default rounded-md px-3 py-2">📚 笔记本</div>
          <div className="cursor-default rounded-md px-3 py-2">🔍 全文搜索</div>
          <div className="cursor-default rounded-md px-3 py-2">🔄 同步状态</div>
          <div className="px-3 pt-2 text-xs text-zinc-600">
            M1 / M2 / M3 里程碑实现
          </div>
        </nav>
        <div className="mt-auto text-xs text-zinc-600">M0 · 连通性验证</div>
      </aside>

      {/* 主区 */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold">M0 · 三端连通性验证</h1>
            <p className="mt-1 text-sm text-zinc-400">
              验证 Tauri 前后端桥接：命令调用（前端 → Rust）与事件回推
              （Rust → 前端）。
            </p>
          </header>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* 命令桥 */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-1 font-semibold">① 命令桥 · invoke</h2>
            <p className="mb-3 text-xs text-zinc-500">
              前端调用 Rust 命令 <code className="text-zinc-400">greet</code>，
              Rust 返回字符串。
            </p>
            <form onSubmit={onGreet} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入你的名字…"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
              >
                调用 Rust
              </button>
            </form>
            {greetMsg && (
              <p className="mt-3 rounded-lg bg-zinc-800 p-3 text-sm">
                <span className="mr-1">✅</span>
                {greetMsg}
              </p>
            )}
          </section>

          {/* 事件桥 */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-1 font-semibold">② 事件桥 · invoke + event</h2>
            <p className="mb-3 text-xs text-zinc-500">
              调用{" "}
              <code className="text-zinc-400">ping</code>{" "}
              后，Rust 一边直接返回载荷，一边通过{" "}
              <code className="text-zinc-400">{ECHO_EVENT}</code>{" "}
              事件回推。两条通路都出现即为双向桥接正常。
            </p>
            <form onSubmit={onPing} className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="随便发点什么…"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              />
              <button
                type="submit"
                className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600"
              >
                发送 ping
              </button>
            </form>
            {pingResult && (
              <p className="mt-3 rounded-lg bg-zinc-800 p-3 text-sm">
                <span className="mr-1">✅</span>invoke 直接返回：
                <code className="text-emerald-400">
                  {pingResult.serverName}
                </code>{" "}
                @ {new Date(pingResult.receivedAtUnixMs).toLocaleTimeString()}
              </p>
            )}
            {echoLog.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-zinc-500">
                  事件回推日志（最新在前）
                </div>
                <ul className="space-y-1">
                  {echoLog.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-2 rounded-md bg-zinc-800/60 px-3 py-1.5 text-sm"
                    >
                      <span className="text-xs text-zinc-500">{entry.at}</span>
                      <span>{entry.message}</span>
                      <span className="ml-auto text-xs text-emerald-500">
                        via event
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <footer className="text-xs text-zinc-600">
            下一步：M1 单机笔记核心（Vault + Milkdown 编辑器 + SQLite 全文搜索）
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
