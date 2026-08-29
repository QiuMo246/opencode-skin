import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { api, type DesktopTheme, type SkinApplyParams } from "../api";
import { applyResultMsg, DEFAULT_BLUR_PX, DEFAULT_DT_PARAMS, useDesktopSkin } from "../lib/desktopSkin";
import DesktopStatusBar from "../components/DesktopStatusBar";

const PreviewPanel = memo(function PreviewPanel({
  params,
  bgPreview,
  shot,
  onShotClose,
}: {
  params: SkinApplyParams;
  bgPreview: string | null;
  shot: string | null;
  onShotClose: () => void;
}) {
  const wb = params.windowBlurPx ?? DEFAULT_BLUR_PX;
  const isTransparent = (params.windowAlpha ?? 1) < 1;
  const wScale = isTransparent ? (params.windowAlpha ?? 1) : 1;
  const baseAlpha = params.appearance === "light" ? 0.72 : 0.78;
  const panelBgAlpha = Math.max(0.05, baseAlpha * wScale);
  const wallFilter = `brightness(${params.imgBrightness ?? 100}%) contrast(${params.imgContrast ?? 100}%) saturate(${params.imgSaturate ?? 100}%)${wb > 0 ? ` blur(${wb}px)` : ""}`;
  const panelBlur = wb > 0 ? Math.round(18 + wb * 0.6) : 18;
  const panelSat = wb > 0 ? Math.min(1.5, 1.1 + wb * 0.015).toFixed(2) : "1.10";
  const accentHex = params.accentHex ?? "#88c0d0";
  const hexToRgb = (hex: string) => {
    let h = hex.replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mixRgb = (base: string, tint: number) => {
    const [r, g, b] = base.split(",").map(Number);
    const [ar, ag, ab] = hexToRgb(accentHex);
    const m = Math.max(0, Math.min(1, tint));
    return `${Math.round(r + (ar - r) * m)},${Math.round(g + (ag - g) * m)},${Math.round(b + (ab - b) * m)}`;
  };
  const rgb = mixRgb(params.appearance === "light" ? "249,247,241" : "28,28,34", params.panelTint ?? 0);
  const contentRgb = mixRgb(
    params.appearance === "light" ? "253,251,245" : "30,30,36",
    params.contentTint ?? 0,
  );

  const placeholderStyle: React.CSSProperties = useMemo(
    () => ({
      position: "absolute",
      inset: 0,
      background: `radial-gradient(40% 40% at 30% 30%, ${accentHex}33, transparent 60%), radial-gradient(30% 30% at 80% 70%, ${accentHex}22, transparent 60%)`,
      ...(wb > 0 ? { filter: `blur(${Math.round(wb * 0.5)}px)` } : {}),
    }),
    [accentHex, wb],
  );

  return (
    <>
      <div
        className="preview"
        style={{
          background: params.appearance === "light" ? "#eceff4" : "#1a1d27",
          border: "1px solid var(--stroke)",
          minHeight: 220,
        }}
      >
        {bgPreview ? (
          <img
            src={bgPreview}
            alt="壁纸预览"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: params.imgOpacity ?? 1,
              filter: wallFilter,
            }}
          />
        ) : (
          <div style={placeholderStyle} />
        )}
        <div
          style={{
            position: "relative",
            backgroundColor: `rgba(${rgb},${panelBgAlpha})`,
            backdropFilter: `blur(${panelBlur}px) saturate(${panelSat})`,
            WebkitBackdropFilter: `blur(${panelBlur}px) saturate(${panelSat})`,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 12px",
              fontSize: 12,
              borderBottom: "1px solid rgba(128,128,128,0.12)",
              background: `rgba(${rgb},${panelBgAlpha * 0.85})`,
            }}
          >
            <span>
              OpenCode — {params.appearance === "light" ? "浅色" : "深色"} · 窗口模糊{" "}
              {params.windowBlurPx ?? DEFAULT_BLUR_PX}px
            </span>
            <span style={{ color: accentHex }}>{accentHex}</span>
          </div>
          <div
            style={{
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 12.5,
              background: `rgba(${contentRgb},0.1)`,
            }}
          >
            <p style={{ margin: 0, color: params.appearance === "light" ? "#2d3748" : "#e2e8f0" }}>
              窗口透明 {Math.round((1 - (params.windowAlpha ?? 1)) * 100)}% · 模糊{" "}
              {params.windowBlurPx ?? DEFAULT_BLUR_PX}
              px
            </p>
            <div
              style={{
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                background:
                  params.appearance === "light" ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.06)",
                border: "1px solid rgba(128,128,128,0.1)",
              }}
            >
              accent: {accentHex} · focus {Math.round((params.focusX ?? 0.5) * 100)}% ×{" "}
              {Math.round((params.focusY ?? 0.5) * 100)}%
            </div>
            <div
              style={{
                borderRadius: 8,
                overflow: "hidden",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                border: "1px solid rgba(128,128,128,0.12)",
              }}
            >
              <div style={{ padding: "4px 8px", background: "rgba(128,128,128,0.08)" }}>diff 示例</div>
              <div style={{ padding: "6px 8px", background: "rgba(115,215,162,0.12)" }}>+ 新增行</div>
              <div style={{ padding: "6px 8px", background: "rgba(242,140,160,0.1)" }}>- 删除行</div>
            </div>
          </div>
        </div>
        <span className="pv-mode-tag">{(params.appearance ?? "dark").toUpperCase()}</span>
      </div>
      <p className="muted preview-note">
        左侧改动 400ms 后自动同步到桌面端；壁纸上传请到「壁纸工作台」。截图预览在下方弹出，点击可关闭。
      </p>
      {shot && (
        <div className="dt-shot">
          <img src={shot} alt="桌面端截图预览" onClick={onShotClose} title="点击关闭" />
        </div>
      )}
      {bgPreview && (
        <div style={{ marginTop: 10 }}>
          <img
            src={bgPreview}
            alt="当前壁纸"
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px solid var(--stroke)",
              maxHeight: 180,
              objectFit: "cover",
            }}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 6, textAlign: "center" }}>
            当前壁纸 · 在壁纸工作台更换
          </div>
        </div>
      )}
    </>
  );
});

export default function DesktopEditorPage() {
  const { params, update, bgPreview, applyNow, syncMsg } = useDesktopSkin();
  const [installed, setInstalled] = useState<DesktopTheme[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadList = useCallback(() => {
    api
      .desktopThemes()
      .then((d) => setInstalled(d.themes))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    reloadList();
  }, [reloadList]);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  const load = async (id: string) => {
    const t = installed.find((x) => x.id === id);
    if (!t) return;
    // 完整覆盖当前参数（保留壁纸，壁纸由壁纸工作台管理）
    update({
      appearance: t.params.appearance,
      accentHex: t.params.accentHex,
      focusX: t.params.focusX,
      focusY: t.params.focusY,
      imgBrightness: t.params.imgBrightness,
      imgContrast: t.params.imgContrast,
      imgSaturate: t.params.imgSaturate,
      imgOpacity: t.params.imgOpacity,
      windowAlpha: t.params.windowAlpha,
      windowBlurPx: (t.params as { windowBlurPx?: number }).windowBlurPx,
    });
    setName(t.name);
    setSelected(id);
    flash(`已载入「${t.name}」${t.builtin ? "（精选）" : ""}，改动将实时同步`);
  };

  const newTheme = () => {
    update({ ...DEFAULT_DT_PARAMS });
    setName("");
    setSelected("");
    flash("已新建空白配置，调整参数后保存为主题");
  };

  const save = async (): Promise<string | null> => {
    const target = name.trim();
    if (!target) {
      setError("请先填写主题名称");
      return null;
    }
    setBusy(true);
    try {
      const r = await api.saveDesktopTheme({ name: target, desc: "自定义主题", params });
      flash(`已保存「${r.theme.name}」`);
      reloadList();
      setSelected(r.theme.id);
      return r.theme.id;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveAndApply = async () => {
    const id = await save();
    if (!id) return;
    setBusy(true);
    try {
      const r = await applyNow();
      flash(applyResultMsg(r, `已保存并应用「${name.trim()}」`));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const t = installed.find((x) => x.id === selected);
    if (t?.builtin) {
      setError("精选主题不可删除");
      return;
    }
    setBusy(true);
    try {
      await api.deleteDesktopTheme(selected);
      flash(`已删除「${selected}」`);
      if (name === t?.name) setName("");
      setSelected("");
      reloadList();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const doScreenshot = async () => {
    setBusy(true);
    try {
      const r = await api.cdpScreenshot();
      setShot(r.dataUrl);
      flash("已截取桌面端当前画面");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      await api.cdpRestore();
      flash("已恢复官方外观");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page editor">
      <h2>桌面端 · 主题编辑器</h2>
      <p className="page-desc">
        编辑桌面端玻璃皮肤的全部参数，改动 400ms 后自动实时同步到已连接的 OpenCode Desktop；保存后写入主题库。
      </p>
      <DesktopStatusBar />

      <div className="editor-toolbar">
        <button onClick={newTheme}>新建</button>
        <select value={selected} onChange={(e) => e.target.value && void load(e.target.value)}>
          <option value="">— 选择已保存主题载入 —</option>
          {installed.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.builtin ? " · 精选" : ""}
            </option>
          ))}
        </select>
        <input
          className="name-input"
          placeholder="保存名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" disabled={busy} onClick={() => void save()}>
          保存
        </button>
        <button className="primary" disabled={busy} onClick={() => void saveAndApply()}>
          保存并应用
        </button>
        <button className="danger" onClick={() => void remove()} disabled={!selected || busy}>
          删除选中
        </button>
        <span className="muted">{syncMsg ?? "改动自动同步 · 截图可在右侧预览"}</span>
        <span className="toolbar-spacer" />
        <button className="btn-ghost" disabled={busy} onClick={() => void doScreenshot()}>
          截图预览
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => void doRestore()}>
          恢复默认
        </button>
      </div>

      {error && <p className="alert alert-err">{error}</p>}
      {notice && <p className="alert alert-ok">{notice}</p>}

      <div className="editor-grid">
        <div className="editor-slots">
          <fieldset className="slot-group">
            <legend>外观</legend>
            <div className="slot-pair">
              <span className="slot-key">appearance</span>
              <div className="slot-sides">
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>深浅模式</span>
                  <select
                    value={params.appearance ?? "dark"}
                    onChange={(e) => update({ appearance: e.target.value as "dark" | "light" })}
                  >
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>强调色 {params.accentHex}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="color"
                      className="slot-swatch"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(params.accentHex ?? "")
                          ? (params.accentHex as string)
                          : "#88c0d0"
                      }
                      onChange={(e) => update({ accentHex: e.target.value })}
                    />
                    <input
                      className="slot-value"
                      value={params.accentHex ?? ""}
                      spellCheck={false}
                      onChange={(e) => update({ accentHex: e.target.value })}
                      placeholder="#88c0d0"
                    />
                  </span>
                </label>
              </div>
            </div>
            <div className="slot-pair">
              <span className="slot-key">windowAlpha</span>
              <div className="slot-sides">
                <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    窗口透明 {Math.round((1 - (params.windowAlpha ?? 1)) * 100)}%（0%
                    关闭；开启后真实透出桌面， 任何模糊值下都保持可见）
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={70}
                    value={Math.round((1 - (params.windowAlpha ?? 1)) * 100)}
                    onChange={(e) => update({ windowAlpha: 1 - Number(e.target.value) / 100 })}
                  />
                </label>
              </div>
            </div>
            <div className="slot-pair">
              <span className="slot-key">windowBlurPx</span>
              <div className="slot-sides">
                <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    壁纸磨砂 {params.windowBlurPx ?? DEFAULT_BLUR_PX}
                    px（模糊壁纸垫底层与玻璃面板；桌面本身无法被系统模糊——Windows 对 Electron
                    窗口不提供毛玻璃，透明度负责控制桌面的可见程度）
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={params.windowBlurPx ?? DEFAULT_BLUR_PX}
                    onChange={(e) => update({ windowBlurPx: Number(e.target.value) })}
                  />
                </label>
              </div>
            </div>
          </fieldset>
        </div>

        <aside className="editor-preview">
          <h3>实时预览</h3>
          <PreviewPanel params={params} bgPreview={bgPreview} shot={shot} onShotClose={() => setShot(null)} />
        </aside>
      </div>
    </section>
  );
}
