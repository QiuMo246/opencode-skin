import { useCallback, useEffect, useState } from "react";
import { api, type Swatch } from "../api";
import { compressAndExtract, compressToDataUrl } from "../lib/imageClient";
import { applyResultMsg, useDesktopSkin } from "../lib/desktopSkin";
import DesktopStatusBar from "../components/DesktopStatusBar";

const MAX_SIDE = 1920;

type Stage = "idle" | "loading" | "extracting" | "ready";
type Payload = { dataUrl: string };

export default function WallpaperWorkbenchPage() {
  const { params, update, bgPreview, setWallpaper, clearWallpaper, applyNow } = useDesktopSkin();
  const [wallpapers, setWallpapers] = useState<Array<{ id: string; title: string }>>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Payload | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [palette, setPalette] = useState<Swatch[]>([]);

  useEffect(() => {
    api.builtinWallpapers().then((r) => setWallpapers(r.wallpapers)).catch(() => {});
  }, []);

  useEffect(() => {
    if (bgPreview) {
      setPreview({ dataUrl: bgPreview });
      setWallpaperUrl(bgPreview);
      setStage("ready");
    }
  }, [bgPreview]);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  const selectSource = useCallback(async (src: File | string) => {
    setError(null);
    setNotice(null);
    try {
      setStage("loading");
      const wp = await compressToDataUrl(src, MAX_SIDE);
      setWallpaper(wp); // 写入共享上下文，防抖自动应用
      setPreview({ dataUrl: wp });
      setWallpaperUrl(wp);
      setStage("extracting");
      const p = await compressAndExtract(src);
      const r = await api.paletteFromPixels(p.width, p.height, p.pixelsB64);
      setPalette(r.palette);
      setStage("ready");
      flash("壁纸已应用，点击下方色块可一键设为强调色");
    } catch (e) {
      setStage("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setWallpaper]);

  const busy = stage === "loading" || stage === "extracting";

  const useAccent = async (hex: string) => {
    update({ accentHex: hex });
    try {
      const r = await applyNow({ accentHex: hex });
      flash(`已把强调色设为 ${hex} · ${applyResultMsg(r, "")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const applyWallpaper = async () => {
    if (!wallpaperUrl) return;
    try {
      const r = await applyNow();
      flash(applyResultMsg(r, "壁纸已应用"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <h2>桌面端 · 壁纸工作台</h2>
      <p className="page-desc">上传或选择内置壁纸，取色生成强调色，调整焦点与画面参数，实时同步到 OpenCode Desktop。</p>
      <DesktopStatusBar />
      {error && <div className="alert alert-err">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="gallery-grid">
        <div className="gallery-right">
          {preview ? (
            <>
              <img className="preview-img" src={preview.dataUrl} alt="壁纸预览" />
              {palette.length > 0 && (
                <>
                  <div className="muted">点击色块设为桌面端强调色（当前：{params.accentHex}）</div>
                  <div className="palette-row">
                    {palette.map((s) => (
                      <button
                        key={s.hex}
                        className={`swatch swatch-btn${params.accentHex === s.hex ? " active" : ""}`}
                        style={{ background: s.hex }}
                        title={`${s.hex} · ${Math.round(s.share * 100)}%`}
                        disabled={busy}
                        onClick={() => void useAccent(s.hex)}
                      >
                        <span>{Math.round(s.share * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="card empty-hint">
              <p>选择左侧图片后，这里会显示预览、调色板与壁纸参数面板。</p>
            </div>
          )}

          <fieldset className="slot-group out-panel">
            <legend>壁纸画面参数</legend>
            <div className="dt-grid">
              <label>焦点 X {Math.round((params.focusX ?? 0.5) * 100)}%
                <input type="range" min={0} max={100} value={Math.round((params.focusX ?? 0.5) * 100)} onChange={(e) => update({ focusX: Number(e.target.value) / 100 })} />
              </label>
              <label>焦点 Y {Math.round((params.focusY ?? 0.5) * 100)}%
                <input type="range" min={0} max={100} value={Math.round((params.focusY ?? 0.5) * 100)} onChange={(e) => update({ focusY: Number(e.target.value) / 100 })} />
              </label>
              <label>亮度 {params.imgBrightness ?? 100}%
                <input type="range" min={20} max={200} value={params.imgBrightness ?? 100} onChange={(e) => update({ imgBrightness: Number(e.target.value) })} />
              </label>
              <label>对比度 {params.imgContrast ?? 100}%
                <input type="range" min={20} max={200} value={params.imgContrast ?? 100} onChange={(e) => update({ imgContrast: Number(e.target.value) })} />
              </label>
              <label>饱和度 {params.imgSaturate ?? 100}%
                <input type="range" min={0} max={200} value={params.imgSaturate ?? 100} onChange={(e) => update({ imgSaturate: Number(e.target.value) })} />
              </label>
              <label>不透明度 {Math.round((params.imgOpacity ?? 1) * 100)}%
                <input type="range" min={10} max={100} value={Math.round((params.imgOpacity ?? 1) * 100)} onChange={(e) => update({ imgOpacity: Number(e.target.value) / 100 })} />
              </label>
            </div>
            <div className="dt-actions">
              <button className="btn btn-primary" disabled={!wallpaperUrl || busy} onClick={() => void applyWallpaper()}>应用壁纸</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => { setPreview(null); setWallpaperUrl(null); setPalette([]); setStage("idle"); clearWallpaper(); }}>清除壁纸</button>
            </div>
            <p className="page-desc">「不透明度」直接控制壁纸强弱；「毛玻璃」等面板参数在主题编辑器中调整。</p>
          </fieldset>
        </div>

        <div className="gallery-left">
          <label
            className={`dropzone${busy ? " busy" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void selectSource(f);
            }}
          >
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void selectSource(f);
                e.currentTarget.value = "";
              }}
            />
            {stage === "loading" ? "处理图片中…" : stage === "extracting" ? "取色计算中…" : "点击或拖拽上传壁纸"}
          </label>
          <h3>内置图库</h3>
          <div className="wp-grid">
            {wallpapers.map((w) => (
              <button key={w.id} className="wp-item" title={w.title} disabled={busy} onClick={() => void selectSource(`/api/images/file/${w.id}`)}>
                <img src={`/api/images/file/${w.id}`} alt={w.title} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
