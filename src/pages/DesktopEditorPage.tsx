import { useEffect, useState } from "react";
import { api, type SkinApplyParams } from "../api";
import { applyResultMsg, useDesktopSkin } from "../lib/desktopSkin";
import DesktopStatusBar from "../components/DesktopStatusBar";

type Preset = { name: string; desc: string; params: Partial<SkinApplyParams> };

export default function DesktopEditorPage() {
  const { params, update, applyNow, syncMsg } = useDesktopSkin();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  // 内置预设直接取自服务端主题库（唯一数据源），避免前后端手工同步
  const [presets, setPresets] = useState<Preset[]>([]);

  useEffect(() => {
    api
      .desktopThemes()
      .then((d) =>
        setPresets(
          d.themes
            .filter((t) => t.builtin)
            .map((t) => ({ name: t.name, desc: t.desc ?? "", params: t.params })),
        ),
      )
      .catch(() => {});
  }, []);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ kind: "ok", text: await fn() });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const saveAsTheme = () =>
    run(async () => {
      const name = saveName.trim();
      if (!name) throw new Error("请先填写主题名称");
      await api.saveDesktopTheme({ name, desc: "自定义主题", params });
      setSaveName("");
      return `已保存为自定义主题「${name}」，可在主题市场中查看`;
    });

  return (
    <div className="page">
      <h2>桌面端 · 主题编辑器</h2>
      <p className="page-desc">
        通过 CDP 调试端口向 OpenCode Desktop 注入毛玻璃面板与壁纸，不修改任何官方文件。参数改动自动实时同步。
      </p>
      <DesktopStatusBar />
      {msg && <div className={msg.kind === "ok" ? "alert alert-ok" : "alert alert-err"}>{msg.text}</div>}

      <div className="card dt-card">
        <h3>皮肤参数</h3>
        <div className="dt-presets">
          {presets.map((ps) => (
            <button
              key={ps.name}
              className="btn btn-ghost preset-btn"
              disabled={busy}
              onClick={() => update(ps.params)}
            >
              <span className="preset-name">{ps.name}</span>
              <span className="preset-desc">{ps.desc}</span>
            </button>
          ))}
        </div>
        <p className="page-desc">点击预设后立即生效（保留当前壁纸）。</p>
        <div className="dt-grid">
          <label>
            模式
            <select
              value={params.appearance}
              onChange={(e) => update({ appearance: e.target.value as "dark" | "light" })}
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label>
            强调色
            <input
              type="color"
              value={params.accentHex ?? "#88c0d0"}
              onChange={(e) => update({ accentHex: e.target.value })}
            />
          </label>
          <label>
            面板不透明度 {Math.round((params.panelAlpha ?? 0) * 100)}%
            <input
              type="range"
              min={20}
              max={98}
              value={Math.round((params.panelAlpha ?? 0.72) * 100)}
              onChange={(e) => update({ panelAlpha: Number(e.target.value) / 100 })}
            />
          </label>
          <label>
            毛玻璃 {params.blurPx}px
            <input
              type="range"
              min={0}
              max={40}
              value={params.blurPx ?? 16}
              onChange={(e) => update({ blurPx: Number(e.target.value) })}
            />
          </label>
          <label>
            标题栏 {Math.round((params.titlebarAlpha ?? 0) * 100)}%
            <input
              type="range"
              min={0}
              max={95}
              value={Math.round((params.titlebarAlpha ?? 0.6) * 100)}
              onChange={(e) => update({ titlebarAlpha: Number(e.target.value) / 100 })}
            />
          </label>
        </div>
        <div className="dt-actions">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => run(async () => applyResultMsg(await applyNow(), "已注入当前窗口"))}
          >
            应用皮肤
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.cdpScreenshot();
                setShot(r.dataUrl);
                return "已截取桌面端当前画面";
              })
            }
          >
            截图预览
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.cdpRestore();
                return "已恢复官方外观";
              })
            }
          >
            恢复默认
          </button>
          {syncMsg && <span className="auto-msg">{syncMsg}</span>}
        </div>
        <div className="dt-save-row">
          <input
            placeholder="保存当前配置为自定义主题…"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            disabled={busy || !saveName.trim()}
            onClick={() => void saveAsTheme()}
          >
            保存为主题
          </button>
        </div>
        {shot && (
          <div className="dt-shot">
            <img src={shot} alt="桌面端截图预览" onClick={() => setShot(null)} title="点击关闭" />
          </div>
        )}
        <p className="page-desc">
          参数说明：「面板不透明度」控制玻璃底色深浅（底色接近官方配色，视觉变化主要体现在壁纸透出程度）；「毛玻璃」越大壁纸越模糊。壁纸相关参数在「壁纸工作台」调整。
        </p>
      </div>
    </div>
  );
}
