import fs from "node:fs";
import WebSocket from "ws";

/** 开发调试：对 OpenCode Desktop 页面目标执行表达式。用法：npx tsx scripts/probe-cdp.ts <expr-file> */
async function main() {
  const list = (await (await fetch("http://127.0.0.1:9222/json")).json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const expr = fs.readFileSync(process.argv[2]!, "utf8");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res) =>
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: expr, returnByValue: true },
        }),
      );
      res();
    }),
  );
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as { id: number; result?: { result?: { value?: unknown } } };
    if (msg.id === 1) {
      console.log(
        typeof msg.result?.result?.value === "string"
          ? msg.result.result.value
          : JSON.stringify(msg, null, 2),
      );
      ws.close();
      process.exit(0);
    }
  });
  setTimeout(() => {
    console.error("timeout");
    process.exit(1);
  }, 8000);
}
main();
