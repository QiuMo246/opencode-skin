import { useCallback, useEffect, useState } from "react";
import { api, type Curated, type DesktopTheme, type SkinApplyParams } from "../api";
import { applyResultMsg, useDesktopSkin } from "../lib/desktopSkin";
import { useOfficialColors } from "../lib/useOfficialColors";
import DesktopStatusBar from "../components/DesktopStatusBar";

function luma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** 官方主题配色 → 桌面端玻璃参数：主色作强调色，背景亮度推断深浅模式 */
function mapOfficialColors(colors: string[]): Partial<SkinApplyParams> {
  const bg = colors[0] ?? "#2e3440";
  const accent = colors[1] ?? colors[2] ?? colors[0] ?? "#88c0d0";
  return {
    appearance: luma(bg) > 140 ? "light" : "dark",
    accentHex: accent,
  };
}

export default function DesktopMarketPage() {
  const { update, applyNow, syncMsg } = useDesktopSkin();
  const [curated, setCurated] = useState<Curated | null>(null);
  const themeColors = useOfficialColors();
  const [themes, setThemes] = useState<DesktopTheme[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refreshThemes = useCallback(() => {
    api.desktopThemes().then((d) => setThemes(d.themes)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshThemes();
    if (!curated) api.marketCurated().then(setCurated).catch(() => {});
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
      <p className="page-desc">把官方主题配色一键映射为桌面端玻璃皮肤，或从精选主题库直接应用。壁纸保持不变。</p>
      <DesktopStatusBar />
      {msg && <div className={msg.kind === "ok" ? "alert alert-ok" : "alert alert-err"}>{msg.text}</div>}
      {syncMsg && !msg && <span className="auto-msg">{syncMsg}</span>}

      <h3 className="dtm-sec-title">官方配色映射</h3>
      <p className="page-desc">取官方主题的主色为强调色，按背景亮度自动选择深浅模式，共 {curated?.official.length ?? "…"} 个主题。</p>
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
                  onClick={() => mapped && void applyTheme(`official:${t.id}`, mapped, `已应用「${t.id}」配色`)}
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
            <p className="card-meta">{t.desc || `${t.params.appearance === "light" ? "浅色" : "深色"} · 面板 ${Math.round((t.params.panelAlpha ?? 0.7) * 100)}%`}</p>
            <footer>
              <button
                disabled={busyKey === `theme:${t.id}`}
                onClick={() => void applyTheme(`theme:${t.id}`, t.params, `已应用「${t.name}」`)}
              >
                {busyKey === `theme:${t.id}` ? "应用中…" : "一键应用"}
              </button>
              {!t.builtin && (
                <button className="mk-link btn-as-link" disabled={busyKey === `del:${t.id}`} onClick={() => void removeTheme(t)}>
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
