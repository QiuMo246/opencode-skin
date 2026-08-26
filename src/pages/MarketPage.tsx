import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Curated,
  type InstalledEntry,
  type RepoHit,
} from "../api";
import { useOfficialColors } from "../lib/useOfficialColors";

type Tab = "curated" | "search" | "installed";
type Msg = { type: "ok" | "err"; text: string } | null;

const srcLabel = (s: InstalledEntry["source"]): string =>
  s.kind === "official"
    ? `官方内置 · ${s.id ?? ""}`
    : s.kind === "preset"
      ? `本地预设 · ${s.id ?? ""}`
      : `GitHub · ${s.owner}/${s.repo}`;

export default function MarketPage() {
  const [tab, setTab] = useState<Tab>("curated");
  const [curated, setCurated] = useState<Curated | null>(null);
  const themeColors = useOfficialColors();  const [q, setQ] = useState("opencode theme");
  const [repos, setRepos] = useState<RepoHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [instList, setInstList] = useState<InstalledEntry[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refreshInstalled = useCallback(() => {
    api.marketInstalled().then((d) => setInstList(d.themes)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshInstalled();
    if (!curated) {
      api.marketCurated().then(setCurated).catch((e) => setMsg({ type: "err", text: String(e.message ?? e) }));
    }
  }, [curated, refreshInstalled]);

  const doInstall = async (key: string, body: Parameters<typeof api.marketInstall>[0]) => {
    setBusyKey(key);
    setMsg(null);
    try {
      const r = await api.marketInstall(body);
      setMsg({ type: "ok", text: `已安装主题「${r.name}」，重启 opencode 后可用 /theme 选择` });
      refreshInstalled();
    } catch (e) {
      setMsg({ type: "err", text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusyKey(null);
    }
  };

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setMsg(null);
    try {
      const r = await api.marketSearch(q.trim());
      setRepos(r.repos);
      setTotal(r.totalCount);
    } catch (e) {
      setMsg({ type: "err", text: String(e instanceof Error ? e.message : e) });
      setRepos(null);
    } finally {
      setSearching(false);
    }
  };

  const doCheckUpdates = async () => {
    setBusyKey("check-updates");
    setMsg(null);
    try {
      await api.marketCheckUpdates();
      refreshInstalled();
      setMsg({ type: "ok", text: "已检查全部来源的最新版本" });
    } catch (e) {
      setMsg({ type: "err", text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="page">
      <h2>主题市场</h2>
      <div className="row mk-tabs">
        {(
          [
            ["curated", `官方精选${curated ? ` · ${curated.official.length}` : ""}`],
            ["search", "GitHub 搜索"],
            ["installed", `已安装${instList.length ? ` · ${instList.length}` : ""}`],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "mk-tab active" : "mk-tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {msg && <div className={msg.type === "ok" ? "alert alert-ok" : "alert alert-err"}>{msg.text}</div>}

      {tab === "curated" && (
        <>
          <div className="muted" style={{ marginTop: 12 }}>
            官方内置主题实时取自 anomalyco/opencode 仓库源码，安装后即为本机自定义主题副本。
          </div>
          <div className="grid mk-grid">
            {(curated?.presets ?? []).map((p) => (
              <article key={p.id} className="card mk-card">
                <header>
                  <strong>{p.title}</strong>
                  <span className="pill">预设</span>
                </header>
                <p className="card-meta">{p.desc}</p>
                <footer>
                  <button
                    disabled={busyKey === `preset:${p.id}`}
                    onClick={() => doInstall(`preset:${p.id}`, { kind: "preset", id: p.id })}
                  >
                    {busyKey === `preset:${p.id}` ? "安装中…" : "一键安装"}
                  </button>
                </footer>
              </article>
            ))}
            {(curated?.official ?? []).map((t) => {
              const colors = themeColors[t.id];
              return (
                <article key={t.id} className="card mk-card">
                  <header>
                    <strong>{t.id}</strong>
                    <span className="pill pill-dim">内置</span>
                  </header>
                  {colors && colors.length >= 2 && (
                    <div className="mk-strip" aria-hidden>
                      {colors.map((c) => (
                        <span key={c} style={{ background: c }} />
                      ))}
                    </div>
                  )}
                  <footer>
                    <button
                      disabled={busyKey === `official:${t.id}`}
                      onClick={() => doInstall(`official:${t.id}`, { kind: "official", id: t.id })}
                    >
                      {busyKey === `official:${t.id}` ? "安装中…" : "安装"}
                    </button>
                  </footer>
                </article>
              );
            })}
            {!curated && <div className="muted">正在加载官方主题列表…</div>}
          </div>
        </>
      )}

      {tab === "search" && (
        <>
          <div className="row mk-search">
            <input
              className="name-input mk-q"
              value={q}
              placeholder="搜索 GitHub 上的 opencode 主题仓库…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <button onClick={doSearch} disabled={searching}>
              {searching ? "搜索中…" : "搜索"}
            </button>
          </div>
          {repos && (
            <div className="muted" style={{ margin: "10px 0" }}>
              共 {total} 个结果，按 star 排序
            </div>
          )}
          <div className="grid mk-grid">
            {(repos ?? []).map((r) => (
              <article key={`${r.owner}/${r.repo}`} className="card mk-card">
                <header>
                  <strong>
                    {r.owner}/{r.repo}
                  </strong>
                  <span className="pill pill-dim">★ {r.stars}</span>
                </header>
                <p className="card-meta">{r.description || "（无描述）"}</p>
                <footer>
                  <button
                    disabled={busyKey === `gh:${r.owner}/${r.repo}`}
                    onClick={() =>
                      doInstall(`gh:${r.owner}/${r.repo}`, {
                        kind: "github",
                        owner: r.owner,
                        repo: r.repo,
                      })
                    }
                  >
                    {busyKey === `gh:${r.owner}/${r.repo}` ? "安装中…" : "安装此仓库主题"}
                  </button>
                  <a href={r.url} target="_blank" rel="noreferrer" className="mk-link">
                    查看
                  </a>
                </footer>
              </article>
            ))}
          </div>
          {repos && repos.length === 0 && <div className="muted">没有匹配的仓库，换个关键词试试。</div>}
        </>
      )}

      {tab === "installed" && (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <button onClick={doCheckUpdates} disabled={busyKey === "check-updates"}>
              {busyKey === "check-updates" ? "检查中…" : "检查更新"}
            </button>
            <span className="muted">来源为官方内置或 GitHub 的主题才会联网比对</span>
          </div>
          <div className="mk-inst">
            {instList.map((t) => (
              <div key={t.name} className="card mk-row">
                <div>
                  <strong>{t.name}</strong>
                  <div className="card-meta">{srcLabel(t.source)}</div>
                </div>
                <div className="mk-tags">
                  {t.modified && <span className="badge badge-warn">本地已修改</span>}
                  {t.updateAvailable === true && <span className="badge badge-warn">有更新</span>}
                  {t.updateAvailable === false && <span className="pill pill-dim">最新</span>}
                  {t.updateAvailable === null && t.source.kind !== "preset" && (
                    <span className="pill pill-dim">未检查</span>
                  )}
                  <span className="muted mk-date">{new Date(t.installedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
            {instList.length === 0 && <div className="muted">还没有通过市场安装的主题。</div>}
          </div>
        </>
      )}
    </section>
  );
}
