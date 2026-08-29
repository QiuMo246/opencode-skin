import { useCallback, useEffect, useState } from "react";
import { api, watchTickLabel, type CdpStatus } from "../api";

export default function DesktopStatusBar() {
  const [status, setStatus] = useState<CdpStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.cdpStatus());
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dt-status-wrap">
      <div className="dt-status">
        {status ? (
          <>
            <span className={`pill ${status.portUp ? "pill-ok" : "pill-warn"}`}>
              {status.portUp ? `调试端口已就绪 :${status.cdpPort}` : "调试端口未连接"}
            </span>
            {!status.exeFound && (
              <span className="pill pill-warn" title="可在 .env 或系统环境变量设 OC_SKIN_DESKTOP_EXE 为完整 exe 路径">
                未找到 OpenCode.exe
              </span>
            )}
            {status.exeFound && !status.portUp && (
              <span className="pill-dim" title={status.exePath ?? ""}>
                已检测到 {status.exePath?.split("\\").pop()} · 需以调试端口重起
              </span>
            )}
            {status.pages.length > 0 && <span className="pill-dim">页面目标 ×{status.pages.length}</span>}
            <span className={`pill ${status.watchEnabled ? "pill-ok" : "pill-warn"}`}>
              {status.watchEnabled ? "自动注入守护中" : "守护未开启"}
            </span>
            {status.watchEnabled && watchTickLabel(status.watchLastTickResult) && (
              <span className="pill-dim" title={status.watchLastTickAt ?? undefined}>
                守护：{watchTickLabel(status.watchLastTickResult)}
              </span>
            )}
            {typeof status.lastApplied?.healthOk === "boolean" && (
              <span className={`pill ${status.lastApplied.healthOk ? "pill-ok" : "pill-warn"}`}>
                {status.lastApplied.healthOk
                  ? "注入健康"
                  : "样式可能被覆盖（类名/结构变化）"}
              </span>
            )}
          </>
        ) : (
          <span className="pill-dim">加载中…</span>
        )}
        {msg && <span className="auto-msg">{msg}</span>}
      </div>
      <div className="dt-actions">
        <button
          className="btn"
          disabled={busy}
          title="一键可用：若已有实例在运行会自动重启并带上调试端口"
          onClick={() =>
            run(async () => {
              const s = await api.cdpLaunch();
              // 后端已改为自动兜底：普通启动若遇单实例锁会自动 close+ relaunch
              if (s.launched) return "Desktop 已带调试端口启动";
              if (s.portUp) return "调试端口已可用（复用运行中的实例）";
              return "已连接";
            })
          }
        >
          启动并连接
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.cdpLaunchForce();
              return "已退出旧实例并以调试模式重启";
            })
          }
        >
          退出重启
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
          刷新
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = !(status?.watchEnabled ?? false);
              const r = await api.cdpWatch(next);
              return r.watchEnabled ? "守护已开启：皮肤丢失/重启后自动恢复" : "守护已关闭";
            })
          }
        >
          {status?.watchEnabled ? "关闭自动注入" : "开启自动注入"}
        </button>
      </div>
    </div>
  );
}
