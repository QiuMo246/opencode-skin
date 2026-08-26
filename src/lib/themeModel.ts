export type Variant = { dark?: string; light?: string };

export type TuiThemeJson = {
  $schema?: string;
  defs?: Record<string, string>;
  theme: Record<string, Variant>;
};

type SlotDef = { key: string; label: string };

export const SLOT_GROUPS: Array<{ group: string; slots: SlotDef[] }> = [
  {
    group: "主色",
    slots: [
      { key: "primary", label: "主要强调色" },
      { key: "secondary", label: "次要强调色" },
      { key: "accent", label: "点缀强调色" },
      { key: "error", label: "错误" },
      { key: "warning", label: "警告" },
      { key: "success", label: "成功" },
      { key: "info", label: "信息" },
    ],
  },
  {
    group: "背景",
    slots: [
      { key: "background", label: "整体背景" },
      { key: "backgroundPanel", label: "面板 / 对话框背景" },
      { key: "backgroundElement", label: "元素块背景" },
    ],
  },
  {
    group: "文本",
    slots: [
      { key: "text", label: "正文" },
      { key: "textMuted", label: "次要文字" },
    ],
  },
  {
    group: "边框",
    slots: [
      { key: "border", label: "常规边框" },
      { key: "borderActive", label: "激活边框" },
      { key: "borderSubtle", label: "弱化边框" },
    ],
  },
  {
    group: "Diff 视图",
    slots: [
      { key: "diffAdded", label: "新增文字" },
      { key: "diffRemoved", label: "删除文字" },
      { key: "diffContext", label: "上下文文字" },
      { key: "diffHunkHeader", label: "Hunk 头" },
      { key: "diffHighlightAdded", label: "高亮新增" },
      { key: "diffHighlightRemoved", label: "高亮删除" },
      { key: "diffAddedBg", label: "新增行背景" },
      { key: "diffRemovedBg", label: "删除行背景" },
      { key: "diffContextBg", label: "上下文行背景" },
      { key: "diffLineNumber", label: "行号文字" },
      { key: "diffAddedLineNumberBg", label: "新增行号背景" },
      { key: "diffRemovedLineNumberBg", label: "删除行号背景" },
    ],
  },
  {
    group: "Markdown 渲染",
    slots: [
      { key: "markdownText", label: "正文" },
      { key: "markdownHeading", label: "标题" },
      { key: "markdownLink", label: "链接" },
      { key: "markdownLinkText", label: "链接文字" },
      { key: "markdownCode", label: "行内代码" },
      { key: "markdownBlockQuote", label: "引用块" },
      { key: "markdownEmph", label: "斜体" },
      { key: "markdownStrong", label: "粗体" },
      { key: "markdownHorizontalRule", label: "分隔线" },
      { key: "markdownListItem", label: "列表项" },
      { key: "markdownListEnumeration", label: "列表序号" },
      { key: "markdownImage", label: "图片链接" },
      { key: "markdownImageText", label: "图片文字" },
      { key: "markdownCodeBlock", label: "代码块文字" },
    ],
  },
  {
    group: "语法高亮",
    slots: [
      { key: "syntaxComment", label: "注释" },
      { key: "syntaxKeyword", label: "关键字" },
      { key: "syntaxFunction", label: "函数" },
      { key: "syntaxVariable", label: "变量" },
      { key: "syntaxString", label: "字符串" },
      { key: "syntaxNumber", label: "数字" },
      { key: "syntaxType", label: "类型" },
      { key: "syntaxOperator", label: "运算符" },
      { key: "syntaxPunctuation", label: "标点" },
    ],
  },
];

export const ALL_SLOTS: SlotDef[] = SLOT_GROUPS.flatMap((g) => g.slots);

const SCHEMA_URL = "https://opencode.ai/theme.json";

export function emptyTheme(): TuiThemeJson {
  return { $schema: SCHEMA_URL, theme: {} };
}

export function normalizeLoaded(raw: unknown): TuiThemeJson {
  const out: TuiThemeJson = { $schema: SCHEMA_URL, theme: {} };
  if (typeof raw !== "object" || raw === null) return out;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.defs === "object" && obj.defs !== null && !Array.isArray(obj.defs)) {
    out.defs = {};
    for (const [k, v] of Object.entries(obj.defs as Record<string, unknown>)) {
      if (typeof v === "string") out.defs[k] = v;
    }
    if (Object.keys(out.defs).length === 0) delete out.defs;
  }
  if (typeof obj.theme === "object" && obj.theme !== null) {
    for (const [key, v] of Object.entries(obj.theme as Record<string, unknown>)) {
      if (typeof v === "string") {
        out.theme[key] = { dark: v, light: v };
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        const variant: Variant = {};
        if (typeof rec.dark === "string" || typeof rec.dark === "number") variant.dark = String(rec.dark);
        if (typeof rec.light === "string" || typeof rec.light === "number") variant.light = String(rec.light);
        if (variant.dark !== undefined || variant.light !== undefined) out.theme[key] = variant;
      } else if (typeof v === "number") {
        out.theme[key] = { dark: String(v), light: String(v) };
      }
    }
  }
  return out;
}

export function resolveColor(
  value: string | undefined,
  defs: Record<string, string> | undefined,
  fallback: string,
): string {
  return resolveColorInner(value, defs, fallback, new Set());
}

function resolveColorInner(
  value: string | undefined,
  defs: Record<string, string> | undefined,
  fallback: string,
  seen: Set<string>,
): string {
  if (!value) return fallback;
  if (value === "none") return fallback;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
  if (/^\d+$/.test(value)) return ansiFallback(Number(value), fallback);
  if (defs && typeof defs[value] === "string") {
    if (seen.has(value)) return fallback;
    seen.add(value);
    return resolveColorInner(defs[value], defs, fallback, seen);
  }
  return fallback;
}

/** 与服务端 ANSI 表（server/lib/palette.ts）一致的 256 色回退，保证预览与实际渲染一致。 */
const ANSI_256: string[] = (() => {
  const out = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];
  const toHex = ({ r, g, b }: { r: number; g: number; b: number }): string =>
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const lv = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) out.push(toHex({ r: lv[r], g: lv[g], b: lv[b] }));
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    out.push(toHex({ r: v, g: v, b: v }));
  }
  return out;
})();

function ansiFallback(n: number, fallback: string): string {
  return ANSI_256[n] ?? fallback;
}

export function fallbackFor(mode: "dark" | "light", kind: "bg" | "fg"): string {
  if (mode === "dark") return kind === "bg" ? "#101014" : "#e6e6ef";
  return kind === "bg" ? "#f5f5fa" : "#1a1b26";
}

/** 序列化为可写入 ~/.config/opencode/themes/<name>.json 的结构。
 * 遍历全部槽位（而非 ALL_SLOTS），保留主题文件里的未知键，避免保存即丢数据。 */
export function toThemeJson(theme: TuiThemeJson): object {
  const out: Record<string, unknown> = { $schema: SCHEMA_URL };
  if (theme.defs && Object.keys(theme.defs).length > 0) out.defs = theme.defs;
  const slots: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(theme.theme)) {
    if (v && (v.dark !== undefined || v.light !== undefined)) slots[key] = v;
  }
  out.theme = slots;
  return out;
}
