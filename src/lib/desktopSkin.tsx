import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type CdpApplyResult, type SkinApplyParams } from "../api";

export const DEFAULT_DT_PARAMS: SkinApplyParams = {
  accentHex: "#88c0d0",
  appearance: "dark",
  panelAlpha: 0.72,
  blurPx: 16,
  titlebarAlpha: 0.6,
  focusX: 0.5,
  focusY: 0.5,
  imgBrightness: 100,
  imgContrast: 100,
  imgSaturate: 100,
  imgOpacity: 1,
};

export function applyResultMsg(r: CdpApplyResult, okText: string): string {
  if (r.healthOk === false && r.badHealth && r.badHealth.length > 0) {
    const b = r.badHealth[0];
    return `⚠️ 已注入但健康检查未通过（${b.label} 背景 ${b.bg}）——桌面端界面可能已更新，皮肤可能显示异常`;
  }
  if (r.errors && r.errors.length > 0) {
    return `⚠️ ${r.injected}/${r.total} 个窗口注入成功，其余失败：${r.errors.map((e) => `${e.label} ${e.error}`).join("；")}`;
  }
  return `${okText} ✅`;
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
          panelAlpha: la.panelAlpha ?? p.panelAlpha,
          blurPx: la.blurPx ?? p.blurPx,
          titlebarAlpha: la.titlebarAlpha ?? p.titlebarAlpha,
          focusX: la.focusX ?? p.focusX,
          focusY: la.focusY ?? p.focusY,
          imgBrightness: la.imgBrightness ?? p.imgBrightness,
          imgContrast: la.imgContrast ?? p.imgContrast,
          imgSaturate: la.imgSaturate ?? p.imgSaturate,
          imgOpacity: la.imgOpacity ?? p.imgOpacity,
        }));
        if (la.imageDataUrl) {
          bgRef.current = la.imageDataUrl;
          setBgPreview(la.imageDataUrl);
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
  }, [params, bgPreview]);

  const update = useCallback((patch: Partial<SkinApplyParams>) => {
    dirtyRef.current = true;
    setParams((p) => ({ ...p, ...patch }));
  }, []);

  const setWallpaper = useCallback((dataUrl: string) => {
    dirtyRef.current = true;
    bgRef.current = dataUrl;
    setBgPreview(dataUrl);
  }, []);

  const clearWallpaper = useCallback(() => {
    dirtyRef.current = true;
    bgRef.current = null;
    setBgPreview(null);
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
