import { Router } from "express";
import { listOfficial, PRESETS, install, installedList, checkUpdates, ghJson, readOfficialColors, refreshOfficialColors } from "../lib/market.js";
import type { InstallRequest } from "../lib/market.js";

const router = Router();

type RepoItem = {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  default_branch: string;
  html_url: string;
};

router.get("/curated", async (_req, res) => {
  try {
    const official = await listOfficial();
    void refreshOfficialColors().catch(() => {});
    res.json({ official, presets: PRESETS });
  } catch (e) {
    res.status(502).json({ error: `获取官方主题列表失败: ${e instanceof Error ? e.message : String(e)}` });
  }
});

router.get("/official-colors", async (_req, res) => {
  res.json({ colors: readOfficialColors() });
});

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.status(400).json({ error: "缺少搜索词 q" });
  const perPage = Math.min(Math.max(Number(req.query.per_page ?? 15), 1), 30);
  const url =
    "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(`${q} in:name,description,topics`) +
    `&sort=stars&order=desc&per_page=${perPage}`;
  try {
    const data = await ghJson<{ total_count: number; items: RepoItem[] }>(url);
    const repos = data.items.map((r) => ({
      owner: r.full_name.split("/")[0],
      repo: r.full_name.split("/")[1] ?? r.full_name,
      description: r.description ?? "",
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
      url: r.html_url,
    }));
    res.json({ totalCount: data.total_count, repos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = msg.includes("403") ? "（GitHub API 速率限制，稍后再试）" : "";
    res.status(502).json({ error: `GitHub 搜索失败: ${msg}${hint}` });
  }
});

router.post("/install", async (req, res) => {
  const body = req.body as Partial<InstallRequest>;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "body 必须是 JSON 对象" });
  if (body.kind !== "official" && body.kind !== "preset" && body.kind !== "github") {
    return res.status(400).json({ error: "kind 必须是 official | preset | github" });
  }
  try {
    const result = await install(body as InstallRequest);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/installed", (_req, res) => {
  res.json({ themes: installedList() });
});

router.post("/check-updates", async (_req, res) => {
  try {
    res.json(await checkUpdates());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
