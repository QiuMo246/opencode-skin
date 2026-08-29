import type { TuiThemeJson } from "../lib/themeModel";
import { fallbackFor, resolveColor } from "../lib/themeModel";

type Mode = "dark" | "light";

interface Props {
  theme: TuiThemeJson;
}

export default function Preview({ theme }: Props) {
  return (
    <div className="preview-wrap">
      <PreviewInner theme={theme} mode="dark" />
      <PreviewInner theme={theme} mode="light" />
    </div>
  );
}

function PreviewInner({ theme, mode }: Props & { mode: Mode }) {
  const c = (key: string, kind: "bg" | "fg") =>
    resolveColor(theme.theme[key]?.[mode], theme.defs, fallbackFor(mode, kind));

  const bg = c("background", "bg");
  const panel = c("backgroundPanel", "bg");
  const element = c("backgroundElement", "bg");
  const text = c("text", "fg");
  const muted = c("textMuted", "fg");
  const primary = c("primary", "fg");
  const borderActive = c("borderActive", "fg");
  const borderSubtle = c("borderSubtle", "fg");
  const success = c("success", "fg");

  return (
    <div className="preview" style={{ background: bg }} data-mode={mode}>
      <div className="pv-mode-tag">{mode}</div>

      <div
        className="pv-dialog"
        style={{
          background: panel,
          border: `1px solid ${borderActive}`,
          boxShadow: `0 8px 24px ${mode === "dark" ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.12)"}`,
        }}
      >
        <div className="pv-titlebar" style={{ borderBottom: `1px solid ${borderSubtle}` }}>
          <span style={{ color: primary }}>● build</span>
          <span style={{ color: muted }}>agent: build</span>
        </div>

        <div className="pv-body">
          <p style={{ color: text }}>
            已完成重构，<strong style={{ color: primary }}>12 个文件</strong>通过测试。
          </p>

          <div className="pv-code" style={{ background: element, border: `1px solid ${borderSubtle}` }}>
            <CodeLine theme={theme} mode={mode} />
          </div>

          <div className="pv-diff" style={{ border: `1px solid ${borderSubtle}` }}>
            <DiffLine theme={theme} mode={mode} kind="ctx" n="3" text="export function app() {" />
            <DiffLine theme={theme} mode={mode} kind="add" n="4" text="  return createServer(port)" />
            <DiffLine theme={theme} mode={mode} kind="del" n="4" text="  return startServer(3000)" />
          </div>

          <p style={{ color: muted, fontSize: 11 }}>
            引用 <code style={{ color: success }}>{`{defs}`}</code> 与 none 值在预览中以近似色呈现
          </p>
        </div>

        <div
          className="pv-composer"
          style={{ background: element, borderTop: `1px solid ${borderSubtle}`, color: muted }}
        >
          输入消息…
        </div>
      </div>
    </div>
  );
}

function CodeLine({ theme, mode }: { theme: TuiThemeJson; mode: Mode }) {
  const s = (key: string) =>
    resolveColor(theme.theme[key]?.[mode], theme.defs, mode === "dark" ? "#9aa0b0" : "#555");
  return (
    <pre style={{ margin: 0 }}>
      <code>
        <span style={{ color: s("syntaxComment") }}>{"// 启动服务\n"}</span>
        <span style={{ color: s("syntaxKeyword") }}>const </span>
        <span style={{ color: s("syntaxVariable") }}>server </span>
        <span style={{ color: s("syntaxOperator") }}>= </span>
        <span style={{ color: s("syntaxFunction") }}>createServer</span>
        <span style={{ color: s("syntaxPunctuation") }}>({"{"}</span>
        {"\n  "}
        <span style={{ color: s("syntaxType") }}>port</span>
        <span style={{ color: s("syntaxPunctuation") }}>: </span>
        <span style={{ color: s("syntaxNumber") }}>5175</span>
        <span style={{ color: s("syntaxPunctuation") }}>
          ,{"\n"}
          {"}"})
        </span>
        {"\n  "}
        <span style={{ color: s("syntaxString") }}>"listening..."</span>
      </code>
    </pre>
  );
}

function DiffLine({
  theme,
  mode,
  kind,
  n,
  text,
}: {
  theme: TuiThemeJson;
  mode: Mode;
  kind: "ctx" | "add" | "del";
  n: string;
  text: string;
}) {
  const v = (key: string, fb: string) => resolveColor(theme.theme[key]?.[mode], theme.defs, fb);
  const fbFg = mode === "dark" ? "#c8ccd8" : "#333";
  let bg = v("diffContextBg", mode === "dark" ? "#16161d" : "#fafafa");
  let fg = v("diffContext", fbFg);
  let numBg = bg;
  let sign = " ";

  if (kind === "add") {
    bg = v("diffAddedBg", "rgba(158,206,106,.14)");
    fg = v("diffAdded", "#9ece6a");
    numBg = v("diffAddedLineNumberBg", bg);
    sign = "+";
  } else if (kind === "del") {
    bg = v("diffRemovedBg", "rgba(247,118,142,.14)");
    fg = v("diffRemoved", "#f7768e");
    numBg = v("diffRemovedLineNumberBg", bg);
    sign = "-";
  }

  return (
    <div style={{ background: bg, display: "flex" }}>
      <span
        style={{
          background: numBg,
          color: v("diffLineNumber", "#888"),
          width: 26,
          textAlign: "right",
          paddingRight: 6,
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span style={{ color: fg, padding: "0 8px", whiteSpace: "pre" }}>
        {sign}
        {text}
      </span>
    </div>
  );
}
