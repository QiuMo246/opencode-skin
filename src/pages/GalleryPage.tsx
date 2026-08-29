import { useCallback, useEffect, useState } from "react";
import { api, type InjectorDetect, type Swatch, type WtDetect } from "../api";
import { compressAndExtract } from "../lib/imageClient";

type Stage = "idle" | "compressing" | "extracting" | "ready";
type Payload = { width: number; height: number; pixelsB64: string; dataUrl: string };

export default function GalleryPage() {
  const [wallpapers, setWallpapers] = useState<Array<{ id: string; title: string }>>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [palette, setPalette] = useState<Swatch[]>([]);
  // selectSource 时服务端已算出主题，保存时直接复用，避免重复提取
  const [tuiTheme, setTuiTheme] = useState<object | null>(null);
  const [primaryHex, setPrimaryHex] = useState("#88c0d0");
  const [themeName, setThemeName] = useState("");

  const [wt, setWt] = useState<WtDetect | null>(null);
  const [profileId, setProfileId] = useState("");
  const [acrylic, setAcrylic] = useState(true);
  const [opacity, setOpacity] = useState(72);
  const [imageOpacity, setImageOpacity] = useState(0.35);
  const [stretch, setStretch] = useState("uniformToFill");

  const [inj, setInj] = useState<InjectorDetect | null>(null);
  const [skinId, setSkinId] = useState("");
  const [appearance, setAppearance] = useState("auto");
  const [focusX, setFocusX] = useState(0.5);
  const [focusY, setFocusY] = useState(0.5);

  useEffect(() => {
    api
      .builtinWallpapers()
      .then((r) => setWallpapers(r.wallpapers))
      .catch(() => {});
    api
      .terminalDetect()
      .then(setWt)
      .catch(() => {});
    api
      .injectorDetect()
      .then(setInj)
      .catch(() => {});
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  const selectSource = useCallback(async (src: File | string) => {
    setError(null);
    setNotice(null);
    try {
      setStage("compressing");
      const p = await compressAndExtract(src);
      setPayload(p);
      setStage("extracting");
      const r = await api.paletteFromPixels(p.width, p.height, p.pixelsB64);
      setPalette(r.palette);
      setTuiTheme(r.theme);
      const t = r.theme as { theme?: Record<string, { dark?: string }> };
      if (t.theme?.primary?.dark) setPrimaryHex(t.theme.primary.dark);
      setStage("ready");
    } catch (e) {
      setStage("idle");
      setError(String(e));
    }
  }, []);

  const busy = stage === "compressing" || stage === "extracting";

  const saveTuiTheme = async (apply: boolean) => {
    if (!payload || !tuiTheme) return;
    const name = themeName.trim();
    if (!name) return setError("请先填写主题名称");
    try {
      await api.putTheme(name, tuiTheme);
      flash(
        apply ? `主题「${name}」已保存并应用，重启 opencode 生效` : `主题「${name}」已保存，可在编辑器中微调`,
      );
      if (apply) await api.applyTheme(name);
    } catch (e) {
      setError(String(e));
    }
  };

  const applyWtBackground = async () => {
    if (!payload || !wt?.found) return;
    try {
      const r = await api.terminalSetBackground({
        profileId: profileId || undefined,
        imageDataUrl: payload.dataUrl,
        acrylic,
        opacity,
        imageOpacity,
        stretchMode: stretch,
      });
      flash(`背景已写入（${r.backgroundImage}）。重开 Windows Terminal 窗口生效。`);
      setWt({ ...wt, backupExists: true });
    } catch (e) {
      setError(String(e));
    }
  };

  const restoreWt = async () => {
    try {
      await api.terminalRestore();
      flash("Windows Terminal 设置已还原为备份");
      const d = await api.terminalDetect();
      setWt(d);
    } catch (e) {
      setError(String(e));
    }
  };

  const makeSkinPack = async () => {
    if (!payload) return;
    const id =
      (skinId.trim() || themeName.trim() || "my-skin")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "my-skin";
    try {
      const r = await api.buildSkinPack({
        id,
        name: themeName.trim() || id,
        imageDataUrl: payload.dataUrl,
        accentHex: primaryHex,
        focusX,
        focusY,
        appearance,
      });
      flash(`皮肤包已生成：${r.themePath}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const inject = async () => {
    try {
      const r = await api.runInjector();
      flash(`注入器已执行（${r.launcher}）`);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="page gallery">
      <div className="gallery-grid">
        <div className="gallery-right">
          {error && <p className="alert alert-err">{error}</p>}
          {notice && <p className="alert alert-ok">{notice}</p>}
          {payload ? (
            <>
              <img className="preview-img" src={payload.dataUrl} alt="预览" />
              {palette.length > 0 && (
                <div className="palette-row">
                  {palette.map((s) => (
                    <div
                      key={s.hex}
                      className="swatch"
                      style={{ background: s.hex }}
                      title={`${s.hex} · ${Math.round(s.share * 100)}%`}
                    >
                      <span>{Math.round(s.share * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="card empty-hint">
              <p>选择左侧图片后，这里会显示预览、调色板与三端输出面板。</p>
            </div>
          )}

          <fieldset className="slot-group out-panel">
            <legend>① TUI 主题（官方支持）</legend>
            <div className="row">
              <input
                placeholder="主题名称"
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
              />
              <button disabled={!payload || busy} onClick={() => saveTuiTheme(false)}>
                保存
              </button>
              <button className="primary" disabled={!payload || busy} onClick={() => saveTuiTheme(true)}>
                保存并应用
              </button>
            </div>
          </fieldset>

          {wt?.found ? (
            <fieldset className="slot-group out-panel">
              <legend>② Windows Terminal 背景图（真实可见）</legend>
              <div className="row">
                <label className="fld">Profile</label>
                <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <option value="">默认（defaultProfile）</option>
                  {wt.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <label className="fld">亚克力模糊</label>
                <input type="checkbox" checked={acrylic} onChange={(e) => setAcrylic(e.target.checked)} />
                <label className="fld">窗口不透明度 {opacity}%</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </div>
              <div className="row">
                <label className="fld">背景不透明度 {(imageOpacity * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(imageOpacity * 100)}
                  onChange={(e) => setImageOpacity(Number(e.target.value) / 100)}
                />
                <select value={stretch} onChange={(e) => setStretch(e.target.value)}>
                  <option value="uniformToFill">填充裁剪</option>
                  <option value="uniform">等比适配</option>
                  <option value="fill">拉伸铺满</option>
                  <option value="none">原始尺寸</option>
                </select>
              </div>
              <div className="row">
                <button className="primary" disabled={!payload || busy} onClick={applyWtBackground}>
                  写入背景
                </button>
                <button className="danger" disabled={!wt.backupExists} onClick={restoreWt}>
                  还原备份{wt.backupExists ? "" : "（无）"}
                </button>
              </div>
            </fieldset>
          ) : (
            <fieldset className="slot-group out-panel" disabled>
              <legend>② Windows Terminal 背景图（未检测到，已置灰）</legend>
              <p className="muted">未找到 settings.json；其余功能不受影响。</p>
            </fieldset>
          )}

          <fieldset className="slot-group out-panel">
            <legend>③ 桌面端 CDP 皮肤包（壁纸 + accent）</legend>
            {inj?.found ? (
              <p className="muted">注入器：{inj.repoPath}</p>
            ) : (
              <p className="muted">未检测到 opencodedev-skin 仓库，皮肤包将写入临时 presets 目录。</p>
            )}
            <div className="row">
              <input
                placeholder="皮肤 id（小写字母/数字/-）"
                value={skinId}
                onChange={(e) => setSkinId(e.target.value)}
              />
              <select value={appearance} onChange={(e) => setAppearance(e.target.value)}>
                <option value="auto">跟随系统</option>
                <option value="dark">暗色</option>
                <option value="light">亮色</option>
              </select>
            </div>
            <div className="row">
              <label className="fld">焦点 X {(focusX * 100).toFixed(0)}%</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(focusX * 100)}
                onChange={(e) => setFocusX(Number(e.target.value) / 100)}
              />
              <label className="fld">焦点 Y {(focusY * 100).toFixed(0)}%</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(focusY * 100)}
                onChange={(e) => setFocusY(Number(e.target.value) / 100)}
              />
            </div>
            <div className="row">
              <button className="primary" disabled={!payload || busy} onClick={makeSkinPack}>
                生成皮肤包
              </button>
              <button disabled={!inj?.found || !inj?.launcher} onClick={inject}>
                调用注入器
              </button>
            </div>
          </fieldset>
        </div>

        <div className="gallery-left">
          <label
            className={`dropzone${busy ? " busy" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) selectSource(f);
            }}
          >
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) selectSource(f);
                e.currentTarget.value = "";
              }}
            />
            {stage === "compressing"
              ? "压缩图片中…"
              : stage === "extracting"
                ? "取色计算中…"
                : "点击或拖拽上传图片"}
          </label>
          <h3>内置图库</h3>
          <div className="wp-grid">
            {wallpapers.map((w) => (
              <button
                key={w.id}
                className="wp-item"
                title={w.title}
                disabled={busy}
                onClick={() => selectSource(`/api/images/file/${w.id}`)}
              >
                <img src={`/api/images/file/${w.id}`} alt={w.title} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
