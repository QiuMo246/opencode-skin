import { useCallback, useEffect, useState } from "react";
import { api, type ThemeInfo } from "../api";
import { SLOT_GROUPS, emptyTheme, normalizeLoaded, toThemeJson, type TuiThemeJson } from "../lib/themeModel";
import ColorInput from "../components/ColorInput";
import Preview from "../components/Preview";

export default function EditorPage() {
  const [installed, setInstalled] = useState<ThemeInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<TuiThemeJson>(emptyTheme);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadList = useCallback(() => {
    Promise.all([api.listThemes(), api.tuiConfig()])
      .then(([list, tui]) => {
        setInstalled(list.themes);
        setActiveTheme(typeof tui.theme === "string" ? tui.theme : null);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    reloadList();
  }, [reloadList]);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  const load = async (themeName: string) => {
    try {
      const raw = await api.getTheme(themeName);
      setTheme(normalizeLoaded(raw));
      setName(themeName);
      setSelected(themeName);
      flash(`已载入「${themeName}」`);
    } catch (e) {
      setError(String(e));
    }
  };

  const clean = (): object => toThemeJson(theme);

  const save = async (): Promise<string | null> => {
    const target = name.trim();
    if (!target) {
      setError("请先填写主题名称（保存位置 ~/.config/opencode/themes/<名称>.json）");
      return null;
    }
    try {
      await api.putTheme(target, clean());
      flash(`已保存「${target}」`);
      reloadList();
      return target;
    } catch (e) {
      setError(String(e));
      return null;
    }
  };

  const apply = async () => {
    const saved = await save();
    if (!saved) return;
    try {
      await api.applyTheme(saved);
      setActiveTheme(saved);
      flash(`已应用「${saved}」，重启 opencode 后生效`);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await api.deleteTheme(selected);
      flash(`已删除「${selected}」`);
      if (name === selected) {
        setName("");
        setTheme(emptyTheme());
      }
      setSelected("");
      reloadList();
    } catch (e) {
      setError(String(e));
    }
  };

  const newTheme = () => {
    setTheme(emptyTheme());
    setName("");
    setSelected("");
    flash("已新建空白主题，填写名称后保存");
  };

  const setSlot = (key: string, side: "dark" | "light", value: string | undefined) => {
    setTheme((t) => {
      const prev = t.theme[key] ?? {};
      const next = { ...prev, [side]: value };
      if (next.dark === undefined) delete next.dark;
      if (next.light === undefined) delete next.light;
      return { ...t, theme: { ...t.theme, [key]: next } };
    });
  };

  const setDefs = (defs: Record<string, string>) =>
    setTheme((t) => ({ ...t, defs: Object.keys(defs).length ? defs : undefined }));

  return (
    <section className="page editor">
      <h2>主题编辑器</h2>
      <p className="page-desc">编辑 49 个官方颜色槽位，右侧实时预览深浅两种变体；保存后写入本机主题目录。</p>
      <div className="editor-toolbar">
        <button onClick={newTheme}>新建</button>
        <select value={selected} onChange={(e) => e.target.value && load(e.target.value)}>
          <option value="">— 选择已安装主题载入 —</option>
          {installed.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
              {t.name === activeTheme ? "（使用中）" : ""}
            </option>
          ))}
        </select>
        <input
          className="name-input"
          placeholder="保存名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" onClick={() => save()}>
          保存
        </button>
        <button className="primary" onClick={apply}>
          保存并应用
        </button>
        <button className="danger" onClick={remove} disabled={!selected}>
          删除选中
        </button>
        <span className="muted">
          {activeTheme ? `当前生效：${activeTheme}` : "当前未通过本工具应用过主题"}
        </span>
      </div>

      {error && <p className="alert alert-err">{error}</p>}
      {notice && <p className="alert alert-ok">{notice}</p>}

      <div className="editor-grid">
        <div className="editor-slots">
          <DefsEditor defs={theme.defs ?? {}} onChange={setDefs} />
          {SLOT_GROUPS.map((g) => (
            <fieldset key={g.group} className="slot-group">
              <legend>{g.group}</legend>
              {g.slots.map(({ key, label }) => (
                <div key={key} className="slot-pair">
                  <span className="slot-key">{key}</span>
                  <div className="slot-sides">
                    <ColorInput
                      label={`${label} · dark`}
                      value={theme.theme[key]?.dark}
                      defs={theme.defs}
                      fallbackBg="#101014"
                      onChange={(v) => setSlot(key, "dark", v)}
                    />
                    <ColorInput
                      label={`${label} · light`}
                      value={theme.theme[key]?.light}
                      defs={theme.defs}
                      fallbackBg="#f5f5fa"
                      onChange={(v) => setSlot(key, "light", v)}
                    />
                  </div>
                </div>
              ))}
            </fieldset>
          ))}
        </div>

        <aside className="editor-preview">
          <h3>实时预览</h3>
          <Preview theme={theme} />
          <p className="muted preview-note">
            预览为色块映射示意：未设置的槽位以中性底色呈现，none 与 ANSI 引用以近似色呈现。 实际终端渲染需重启
            opencode 查看。
          </p>
        </aside>
      </div>
    </section>
  );
}

function DefsEditor({
  defs,
  onChange,
}: {
  defs: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState("");

  const add = () => {
    const k = newKey.trim();
    if (!k || k in defs) return;
    onChange({ ...defs, [k]: "#888888" });
    setNewKey("");
  };

  return (
    <fieldset className="slot-group">
      <legend>颜色引用（defs）— 槽位中输入引用名即可复用</legend>
      {Object.entries(defs).map(([k, v]) => (
        <div key={k} className="slot-row">
          <input
            className="slot-value def-key"
            value={k}
            spellCheck={false}
            onChange={(e) => {
              const next = { ...defs };
              delete next[k];
              if (e.target.value.trim()) next[e.target.value.trim()] = v;
              onChange(next);
            }}
          />
          <input
            type="color"
            className="slot-swatch"
            value={/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(v) ? v : "#000000"}
            onChange={(e) => onChange({ ...defs, [k]: e.target.value })}
          />
          <input
            className="slot-value"
            value={v}
            spellCheck={false}
            onChange={(e) => onChange({ ...defs, [k]: e.target.value })}
          />
          <button
            className="danger slim"
            title="删除此引用"
            onClick={() => {
              const next = { ...defs };
              delete next[k];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="row">
        <input
          placeholder="新引用名，如 nord0"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add}>添加引用</button>
      </div>
    </fieldset>
  );
}
