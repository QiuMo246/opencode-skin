import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type CdpApplyResult, type SkinApplyParams } from "../api";

/** 壁纸/窗口模糊的默认值：类型确切的数字，供各处 fallback 引用（windowBlurPx 在参数里是可选字段） */
export const DEFAULT_BLUR_PX = 4;

export const DEFAULT_DT_PARAMS: SkinApplyParams = {
  accentHex: "#88c0d0",
  appearance: "dark",
  focusX: 0.5,
  focusY: 0.5,
  imgBrightness: 100,
  imgContrast: 100,
  imgSaturate: 100,
  imgOpacity: 1,
  windowAlpha: 1,
  windowBlurPx: DEFAULT_BLUR_PX,
};

export function applyResultMsg(r: CdpApplyResult, okText: string): string {
  const fx = r.windowFx ? ` · ${r.windowFx}` : "";
  if (r.healthOk === false && r.badHealth && r.badHealth.length > 0) {
    const b = r.badHealth[0];
    return `⚠️ 已注入但健康检查未通过（${b.label} 背景 ${b.bg}）——桌面端界面可能已更新，皮肤可能显示异常${fx}`;
  }
  if (r.errors && r.errors.length > 0) {
    return `⚠️ ${r.injected}/${r.total} 个窗口注入成功，其余失败：${r.errors.map((e) => `${e.label} ${e.error}`).join("；")}${fx}`;
  }
  return `${okText} ✅${fx}`;
}

type DesktopSkinCtx = {
  params: SkinApplyParams;
  update: (patch: Partial<SkinApplyParams>) => void;
  bgPreview: string | null;
  setWallpaper: (dataUrl: string) => void;
  clearWallpaper: () => void;
  applyNow: (override?: Partial<SkinApplyParams>) => Promise<CdpApplyResult>;
  syncMsg: string | null;
};

const Ctx = createContext<DesktopSkinCtx | null>(null);

export function DesktopSkinProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useState<SkinApplyParams>({ ...DEFAULT_DT_PARAMS });
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const bgRef = useRef<string | null>(null);
  const [bgVersion, setBgVersion] = useState(0);
  const dirtyRef = useRef(false);

  /* 回填上次应用的配置，保证表单与实际生效的皮肤一致 */
  useEffect(() => {
    api
      .cdpStatus()
      .then((s) => {
        const la = s.lastApplied;
        if (!la) return;
        setParams((p) => ({
          ...p,
          appearance: la.light ? "light" : la.light === undefined ? p.appearance : "dark",
          accentHex: la.accentHex ?? p.accentHex,
          focusX: la.focusX ?? p.focusX,
          focusY: la.focusY ?? p.focusY,
          imgBrightness: la.imgBrightness ?? p.imgBrightness,
          imgContrast: la.imgContrast ?? p.imgContrast,
          imgSaturate: la.imgSaturate ?? p.imgSaturate,
          imgOpacity: la.imgOpacity ?? p.imgOpacity,
          windowAlpha: la.windowAlpha ?? p.windowAlpha,
          windowBlurPx: (la as unknown as { windowBlurPx?: number }).windowBlurPx ?? p.windowBlurPx,
          /* 着色参数也须回填：漏掉的话，任意滑杆触发自动应用时映射设置的着色会被静默清零 */
          panelTint: (la as unknown as { panelTint?: number }).panelTint ?? p.panelTint,
          contentTint: (la as unknown as { contentTint?: number }).contentTint ?? p.contentTint,
          /* 动态壁纸：视频地址与首帧海报（工作台据此恢复视频预览） */
          videoUrl: (la as unknown as { videoUrl?: string }).videoUrl ?? p.videoUrl,
          videoPoster: (la as unknown as { videoPoster?: string }).videoPoster ?? p.videoPoster,
        }));
        if (la.imageDataUrl) {
          bgRef.current = la.imageDataUrl;
          setBgPreview(la.imageDataUrl);
        } else if ((la as unknown as { videoPoster?: string }).videoPoster) {
          /* 视频壁纸：编辑页等图片预览处用首帧海报兜底 */
          setBgPreview((la as unknown as { videoPoster: string }).videoPoster);
        }
      })
      .catch(() => {});
  }, []);

  /* 实时预览：参数或壁纸变化后防抖自动应用 */
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      api
        .cdpApply({ ...params, imageDataUrl: bgRef.current ?? undefined })
        .then((r) => setSyncMsg(applyResultMsg(r, "已实时同步")))
        .catch((e) => setSyncMsg(`实时同步失败：${e instanceof Error ? e.message : e}`));
    }, 400);
    return () => clearTimeout(t);
  }, [params, bgVersion]);

  const update = useCallback((patch: Partial<SkinApplyParams>) => {
    dirtyRef.current = true;
    /* 写入动态壁纸时同步丢弃静态图数据，二者互斥（服务端也会忽略，但别白传 800KB base64） */
    if (patch.videoUrl !== undefined) bgRef.current = null;
    setParams((p) => ({ ...p, ...patch }));
  }, []);

  const setWallpaper = useCallback((dataUrl: string) => {
    dirtyRef.current = true;
    bgRef.current = dataUrl;
    setBgPreview(dataUrl);
    /* 换静态图片壁纸时清掉动态壁纸，二者互斥 */
    setParams((p) =>
      p.videoUrl || p.videoPoster ? { ...p, videoUrl: undefined, videoPoster: undefined } : p,
    );
    setBgVersion((v) => v + 1);
  }, []);

  const clearWallpaper = useCallback(() => {
    dirtyRef.current = true;
    bgRef.current = null;
    setBgPreview(null);
    setParams((p) =>
      p.videoUrl || p.videoPoster ? { ...p, videoUrl: undefined, videoPoster: undefined } : p,
    );
    setBgVersion((v) => v + 1);
  }, []);

  const applyNow = useCallback(
    (override?: Partial<SkinApplyParams>) =>
      api.cdpApply({ ...params, ...override, imageDataUrl: bgRef.current ?? undefined }),
    [params],
  );

  return (
    <Ctx.Provider value={{ params, update, bgPreview, setWallpaper, clearWallpaper, applyNow, syncMsg }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDesktopSkin(): DesktopSkinCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDesktopSkin 必须在 DesktopSkinProvider 内使用");
  return v;
}
