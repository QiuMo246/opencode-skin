import { useCallback, useEffect, useState } from "react";
import { api, type Swatch, type VideoWallpaperInfo } from "../api";
import { compressAndExtract, compressToDataUrl, videoPosterAndPixels } from "../lib/imageClient";
import { DEFAULT_BLUR_PX, DEFAULT_DT_PARAMS, applyResultMsg, useDesktopSkin } from "../lib/desktopSkin";
import DesktopStatusBar from "../components/DesktopStatusBar";

const MAX_SIDE = 1920;

/* 壁纸「画面呈现」参数的默认值，新壁纸与「恢复默认值」共用：
 * 配色映射只管颜色与窗口合成，壁纸长什么样（焦点/滤镜/模糊/不透明度）一律归工作台 */
const DEFAULT_PICTURE = {
  focusX: DEFAULT_DT_PARAMS.focusX,
  focusY: DEFAULT_DT_PARAMS.focusY,
  imgBrightness: DEFAULT_DT_PARAMS.imgBrightness,
  imgContrast: DEFAULT_DT_PARAMS.imgContrast,
  imgSaturate: DEFAULT_DT_PARAMS.imgSaturate,
  imgOpacity: DEFAULT_DT_PARAMS.imgOpacity,
  windowBlurPx: DEFAULT_DT_PARAMS.windowBlurPx,
};

type Stage = "idle" | "loading" | "extracting" | "ready";
type Payload = { dataUrl: string };

export default function WallpaperWorkbenchPage() {
  const { params, update, bgPreview, setWallpaper, clearWallpaper, applyNow } = useDesktopSkin();
  const [wallpapers, setWallpapers] = useState<Array<{ id: string; title: string }>>([]);
  const [videoWallpapers, setVideoWallpapers] = useState<VideoWallpaperInfo[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Payload | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [videoPrev, setVideoPrev] = useState<{ src: string; poster?: string } | null>(null);
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    api
      .builtinWallpapers()
      .then((r) => {
        setWallpapers(r.wallpapers);
        setVideoWallpapers(r.videos ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (bgPreview && !params.videoUrl) {
      setPreview({ dataUrl: bgPreview });
      setWallpaperUrl(bgPreview);
      setStage("ready");
    }
  }, [bgPreview, params.videoUrl]);

  /* 视频预览跟着参数走：选中视频、页面回填、清除壁纸都经 params.videoUrl 驱动 */
  useEffect(() => {
    setVideoPrev(params.videoUrl ? { src: params.videoUrl, poster: params.videoPoster } : null);
  }, [params.videoUrl, params.videoPoster]);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  const selectSource = useCallback(
    async (src: File | string) => {
      setError(null);
      setNotice(null);
      try {
        /* 动态壁纸：先取首帧（校验可解码 + 取色），再上传原文件，最后写入参数触发自动应用 */
        const isVideo =
          src instanceof File && (src.type.startsWith("video/") || /\.(mp4|webm)$/i.test(src.name));
        if (isVideo) {
          setStage("extracting");
          const { poster, pixels } = await videoPosterAndPixels(src);
          setStage("loading");
          const up = await api.uploadVideo(src);
          update({
            ...DEFAULT_PICTURE,
            videoUrl: `${window.location.origin}${up.path}`,
            videoPoster: poster,
          });
          setWallpaperUrl(up.path);
          const r = await api.paletteFromPixels(pixels.width, pixels.height, pixels.pixelsB64);
          setPalette(r.palette);
          setStage("ready");
          flash("动态壁纸已应用，画面滤镜已重置为默认 · 点击下方色块可一键设为强调色");
          return;
        }
        setStage("loading");
        const wp = await compressToDataUrl(src, MAX_SIDE);
        /* 新壁纸以默认画面参数起步：残留的模糊/焦点/滤镜是旧壁纸（或配色映射）留下的，
         * 如 27px 磨砂 + 70% 对比度会把新壁纸洗成一片色雾 */
        update({ ...DEFAULT_PICTURE });
        setWallpaper(wp); // 写入共享上下文（并清掉动态壁纸），防抖自动应用
        setPreview({ dataUrl: wp });
        setWallpaperUrl(wp);
        setStage("extracting");
        const p = await compressAndExtract(src);
        const r = await api.paletteFromPixels(p.width, p.height, p.pixelsB64);
        setPalette(r.palette);
        setStage("ready");
        flash("壁纸已应用，画面滤镜已重置为默认 · 点击下方色块可一键设为强调色");
      } catch (e) {
        setStage("idle");
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [setWallpaper, update],
  );

  /* 内置动态壁纸：文件已在服务器上，无需上传——取首帧（校验+取色）后直接写入参数 */
  const selectBuiltinVideo = useCallback(
    async (v: VideoWallpaperInfo) => {
      setError(null);
      setNotice(null);
      try {
        setStage("extracting");
        const fileUrl = `/api/images/video/${v.file}`;
        const { poster, pixels } = await videoPosterAndPixels(fileUrl);
        update({ ...DEFAULT_PICTURE, videoUrl: `${window.location.origin}${fileUrl}`, videoPoster: poster });
        setWallpaperUrl(fileUrl);
        const r = await api.paletteFromPixels(pixels.width, pixels.height, pixels.pixelsB64);
        setPalette(r.palette);
        setStage("ready");
        flash(`动态壁纸「${v.title}」已应用 · 点击下方色块可一键设为强调色`);
      } catch (e) {
        setStage("idle");
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [update],
  );

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

  const resetPictureParams = async () => {
    update({ ...DEFAULT_PICTURE });
    try {
      const r = await applyNow({ ...DEFAULT_PICTURE });
      flash(applyResultMsg(r, "画面参数已恢复默认值"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const screenshotPreview = async () => {
    setError(null);
    setNotice(null);
    try {
      const r = await api.cdpScreenshot();
      setShot(r.dataUrl);
      setNotice("已截取桌面端当前画面");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <h2>桌面端 · 壁纸工作台</h2>
      <p className="page-desc">
        上传图片/视频或选择内置壁纸，取色生成强调色，调整焦点与画面参数，实时同步到 OpenCode Desktop。
      </p>
      <DesktopStatusBar />
      {error && <div className="alert alert-err">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="gallery-grid">
        <div className="gallery-right">
          {preview || videoPrev ? (
            <>
              {videoPrev ? (
                <video
                  className="preview-img"
                  src={videoPrev.src}
                  poster={videoPrev.poster}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                preview && <img className="preview-img" src={preview.dataUrl} alt="壁纸预览" />
              )}
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
              <p>选择左侧图片或视频后，这里会显示预览、调色板与壁纸参数面板。</p>
            </div>
          )}

          <fieldset className="slot-group out-panel">
            <legend>壁纸画面参数</legend>
            <div className="dt-grid">
              <label>
                焦点 X {Math.round((params.focusX ?? 0.5) * 100)}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((params.focusX ?? 0.5) * 100)}
                  onChange={(e) => update({ focusX: Number(e.target.value) / 100 })}
                />
              </label>
              <label>
                焦点 Y {Math.round((params.focusY ?? 0.5) * 100)}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((params.focusY ?? 0.5) * 100)}
                  onChange={(e) => update({ focusY: Number(e.target.value) / 100 })}
                />
              </label>
              <label>
                亮度 {params.imgBrightness ?? 100}%
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={params.imgBrightness ?? 100}
                  onChange={(e) => update({ imgBrightness: Number(e.target.value) })}
                />
              </label>
              <label>
                对比度 {params.imgContrast ?? 100}%
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={params.imgContrast ?? 100}
                  onChange={(e) => update({ imgContrast: Number(e.target.value) })}
                />
              </label>
              <label>
                饱和度 {params.imgSaturate ?? 100}%
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={params.imgSaturate ?? 100}
                  onChange={(e) => update({ imgSaturate: Number(e.target.value) })}
                />
              </label>
              <label>
                不透明度 {Math.round((params.imgOpacity ?? 1) * 100)}%
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round((params.imgOpacity ?? 1) * 100)}
                  onChange={(e) => update({ imgOpacity: Number(e.target.value) / 100 })}
                />
              </label>
              <label>
                壁纸/窗口模糊 {params.windowBlurPx ?? DEFAULT_BLUR_PX}px
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={params.windowBlurPx ?? DEFAULT_BLUR_PX}
                  onChange={(e) => update({ windowBlurPx: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="dt-actions">
              <button
                className="btn btn-primary"
                disabled={!wallpaperUrl || busy}
                onClick={() => void applyWallpaper()}
              >
                应用壁纸
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => void screenshotPreview()}>
                截图预览
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setWallpaperUrl(null);
                  setPalette([]);
                  setStage("idle");
                  clearWallpaper();
                }}
              >
                清除壁纸
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => void resetPictureParams()}>
                恢复默认值
              </button>
            </div>
            {shot && (
              <div className="dt-shot">
                <img src={shot} alt="桌面端截图预览" onClick={() => setShot(null)} title="点击关闭" />
              </div>
            )}
            <p className="page-desc">
              「不透明度」控制壁纸强弱：越高壁纸越清晰、玻璃面纱越轻；「壁纸/窗口模糊」不透明时模糊壁纸，透明时模糊桌面，数值越大越糊。
            </p>
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
              accept="image/*,video/mp4,video/webm"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void selectSource(f);
                e.currentTarget.value = "";
              }}
            />
            {stage === "loading"
              ? "处理中…"
              : stage === "extracting"
                ? "取色计算中…"
                : "点击或拖拽上传壁纸（图片 / mp4 / webm 视频）"}
          </label>
          <p className="muted">
            选择视频即设为动态壁纸：静音循环播放，服务器需保持运行；关闭后自动退回首帧画面。
          </p>
          <h3>内置图库</h3>
          <div className="wp-grid">
            {wallpapers.map((w) => (
              <button
                key={w.id}
                className="wp-item"
                title={w.title}
                disabled={busy}
                onClick={() => void selectSource(`/api/images/file/${w.id}`)}
              >
                <img src={`/api/images/file/${w.id}`} alt={w.title} loading="lazy" />
              </button>
            ))}
          </div>
          {videoWallpapers.length > 0 && (
            <>
              <h3>内置动态壁纸</h3>
              <div className="wp-grid">
                {videoWallpapers.map((v) => (
                  <button
                    key={v.id}
                    className="wp-item"
                    title={`${v.title}（点击应用）`}
                    disabled={busy}
                    onClick={() => void selectBuiltinVideo(v)}
                  >
                    <video src={`/api/images/video/${v.file}`} poster={v.poster} muted preload="metadata" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
