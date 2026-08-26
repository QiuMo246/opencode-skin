import { useCallback, useEffect, useState } from "react";
import { api, type CdpStatus } from "../api";

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
            {status.pages.length > 0 && <span className="pill-dim">页面目标 ×{status.pages.length}</span>}
            <span className={`pill ${status.watchEnabled ? "pill-ok" : "pill-warn"}`}>
              {status.watchEnabled ? "自动注入守护中" : "守护未开启"}
            </span>
          </>
        ) : (
          <span className="pill-dim">加载中…</span>
        )}
        {msg && <span className="auto-msg">{msg}</span>}
      </div>
      <div className="dt-actions">
        <button className="btn" disabled={busy} onClick={() => run(async () => {
          const s = await api.cdpLaunch();
          return s.launched ? "Desktop 已带调试端口启动" : "调试端口已可用（复用运行中的实例）";
        })}>
          启动并连接
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => run(async () => {
          await api.cdpLaunchForce();
          return "已退出旧实例并以调试模式重启";
        })}>
          退出重启
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>刷新</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => run(async () => {
          const next = !(status?.watchEnabled ?? false);
          const r = await api.cdpWatch(next);
          return r.watchEnabled ? "守护已开启：皮肤丢失/重启后自动恢复" : "守护已关闭";
        })}>
          {status?.watchEnabled ? "关闭自动注入" : "开启自动注入"}
        </button>
      </div>
    </div>
  );
}
