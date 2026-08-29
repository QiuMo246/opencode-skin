import { useCallback, useEffect, useState } from "react";
import { api, type Curated, type DesktopTheme, type SkinApplyParams } from "../api";
import { applyResultMsg, useDesktopSkin } from "../lib/desktopSkin";
import { mapOfficialColors, respectTransparencyOff } from "../lib/officialMapping";
import { useOfficialColors } from "../lib/useOfficialColors";
import DesktopStatusBar from "../components/DesktopStatusBar";

export default function DesktopMarketPage() {
  const { params, update, applyNow, syncMsg } = useDesktopSkin();
  const [curated, setCurated] = useState<Curated | null>(null);
  const themeColors = useOfficialColors();
  const [themes, setThemes] = useState<DesktopTheme[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refreshThemes = useCallback(() => {
    api
      .desktopThemes()
      .then((d) => setThemes(d.themes))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshThemes();
    if (!curated)
      api
        .marketCurated()
        .then(setCurated)
        .catch(() => {});
  }, [curated, refreshThemes]);

  async function applyTheme(key: string, params: Partial<SkinApplyParams>, okText: string) {
    setBusyKey(key);
    setMsg(null);
    try {
      update(params);
      const r = await applyNow(params);
      setMsg({ kind: "ok", text: applyResultMsg(r, okText) });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyKey(null);
    }
  }

  const removeTheme = async (t: DesktopTheme) => {
    setBusyKey(`del:${t.id}`);
    try {
      await api.deleteDesktopTheme(t.id);
      refreshThemes();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="page">
      <h2>桌面端 · 主题市场</h2>
      <p className="page-desc">
        从官方主题的 5
        色色板提取背景、主色等属性，自动映射到强调色、深浅模式、窗口透明度与面板/内容着色。壁纸及其画面参数（模糊/焦点/亮度/对比度/饱和度）保持不变，由壁纸工作台负责。
      </p>
      <DesktopStatusBar />
      {msg && <div className={msg.kind === "ok" ? "alert alert-ok" : "alert alert-err"}>{msg.text}</div>}
      {syncMsg && !msg && <span className="auto-msg">{syncMsg}</span>}

      <h3 className="dtm-sec-title">官方配色映射</h3>
      <p className="page-desc">
        从色板的 HSL
        属性（明度、饱和度、色相）推导玻璃参数：主色作为强调色并直接为面板/内容区着色，着色强度随主题饱和度拉开（0.05–0.65），不同主题的底色色调与玻璃感可感知地不同。窗口透明已关闭（0%）时不会被主题强制开启，仅已开启时按主题重调强度。共{" "}
        {curated?.official.length ?? "…"} 个主题。
      </p>
      <div className="grid mk-grid">
        {(curated?.official ?? []).map((t) => {
          const colors = themeColors[t.id];
          const mapped = colors && colors.length > 0 ? mapOfficialColors(colors) : null;
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
                  disabled={!mapped || busyKey === `official:${t.id}`}
                  onClick={() =>
                    mapped &&
                    void applyTheme(
                      `official:${t.id}`,
                      respectTransparencyOff(mapped, params.windowAlpha),
                      `已应用「${t.id}」配色`,
                    )
                  }
                >
                  {busyKey === `official:${t.id}` ? "应用中…" : "应用此配色"}
                </button>
              </footer>
            </article>
          );
        })}
        {!curated && <div className="muted">正在加载官方主题列表…</div>}
      </div>

      <h3 className="dtm-sec-title">精选与自定义主题库</h3>
      <div className="grid mk-grid">
        {themes.map((t) => (
          <article key={t.id} className="card mk-card">
            <header>
              <strong>{t.name}</strong>
              <span className={`pill ${t.builtin ? "pill-dim" : ""}`}>{t.builtin ? "精选" : "自定义"}</span>
            </header>
            <div className="mk-strip" aria-hidden>
              <span style={{ background: t.params.accentHex ?? "#88c0d0" }} />
              <span style={{ background: t.params.appearance === "light" ? "#eceff4" : "#2e3440" }} />
            </div>
            <p className="card-meta">
              {t.desc ||
                `${t.params.appearance === "light" ? "浅色" : "深色"} · ${t.params.accentHex ?? "#88c0d0"}`}
            </p>
            <footer>
              <button
                disabled={busyKey === `theme:${t.id}`}
                onClick={() => void applyTheme(`theme:${t.id}`, t.params, `已应用「${t.name}」`)}
              >
                {busyKey === `theme:${t.id}` ? "应用中…" : "一键应用"}
              </button>
              {!t.builtin && (
                <button
                  className="mk-link btn-as-link"
                  disabled={busyKey === `del:${t.id}`}
                  onClick={() => void removeTheme(t)}
                >
                  删除
                </button>
              )}
            </footer>
          </article>
        ))}
        {themes.length === 0 && <div className="muted">主题库加载中…</div>}
      </div>
    </div>
  );
}
