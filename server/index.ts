import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initSchemas, schemaStatus, refreshSchemas } from "./lib/schema.js";
import { ensureDirs } from "./lib/paths.js";
import themesRouter from "./routes/themes.js";
import imagesRouter from "./routes/images.js";
import terminalRouter from "./routes/terminal.js";
import desktopRouter from "./routes/desktop.js";
import marketRouter from "./routes/market.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5175);
const HOST = "127.0.0.1";

initSchemas();
ensureDirs();

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "oc-skin-studio", version: "0.2.0" });
});

app.get("/api/schema/status", (_req, res) => {
  res.json(schemaStatus());
});

app.post("/api/schema/refresh", async (_req, res) => {
  res.json(await refreshSchemas());
});

app.use("/api/themes", themesRouter);
app.use("/api/images", imagesRouter);
app.use("/api/terminal", terminalRouter);
app.use("/api/desktop", desktopRouter);
app.use("/api/market", marketRouter);

app.use("/api", (req, res) => {
  res.status(404).json({ error: `unknown API route: ${req.method} ${req.originalUrl}` });
});

const distDir = path.join(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

/* 错误处理器必须最后注册，才能兜住静态资源等路径抛出的异常 */
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[oc-skin-studio] 未处理异常:", err instanceof Error ? (err.stack ?? err.message) : err);
  if (res.headersSent) return;
  /* body-parser 超限等错误自带 status/statusCode（如 413），按原状态码返回而非一律 500 */
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const raw = typeof e?.status === "number" ? e.status : e?.statusCode;
  const status = typeof raw === "number" && raw >= 400 && raw < 600 ? raw : 500;
  const message =
    status === 413
      ? "请求体过大（视频上限 100MB、JSON 上限 10MB）"
      : err instanceof Error
        ? err.message
        : String(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`[oc-skin-studio] listening on http://${HOST}:${PORT}`);
});
