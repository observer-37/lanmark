#!/usr/bin/env node
// CDP 页面求值：node scripts/cdp-eval.mjs "<js-expression>" [port]
// 前提：已 adb forward（见 AGENTS.md「真机调试」），debug APK 的 WebView 开着 devtools。
// 用途：读计算样式/布局指标、触发 React 点击（document.querySelector('…').click()）。
// 依赖：Node ≥ 22（内置 WebSocket），无第三方包。
const expr = process.argv[2];
const port = process.argv[3] || process.env.CDP_PORT || "9222";
if (!expr) {
  console.error("usage: cdp-eval.mjs <js-expression> [port]");
  process.exit(1);
}

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
if (!page) {
  console.error("no page target（检查 adb forward 是否还活着）");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));

const timeout = setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(2);
}, 15000);

ws.onopen = () => {
  send(1, "Runtime.enable", {});
  send(2, "Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== 2) return;
  clearTimeout(timeout);
  if (msg.error) console.error("ERR:", JSON.stringify(msg.error));
  else {
    const r = msg.result;
    if (r.exceptionDetails) {
      console.error("EXCEPTION:", JSON.stringify(r.exceptionDetails, null, 1));
      process.exitCode = 3;
    } else {
      console.log(JSON.stringify(r.result?.value ?? r, null, 1));
    }
  }
  ws.close();
};
