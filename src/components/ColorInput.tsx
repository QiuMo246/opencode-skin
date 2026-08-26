import { resolveColor } from "../lib/themeModel";

interface Props {
  label: string;
  value: string | undefined;
  defs?: Record<string, string>;
  fallbackBg: string;
  onChange: (next: string | undefined) => void;
}

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export default function ColorInput({ label, value, defs, fallbackBg, onChange }: Props) {
  const resolved = resolveColor(value, defs, fallbackBg);
  const pickerValue = HEX_RE.test(resolved) ? resolved : "#000000";

  return (
    <div className="slot-row">
      <span className="slot-label" title={label}>
        {label}
      </span>
      <input
        type="color"
        className="slot-swatch"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        title="拾色器"
      />
      <input
        type="text"
        className="slot-value"
        placeholder="#hex / none / 引用名"
        value={value ?? ""}
        spellCheck={false}
        onChange={(e) => {
          const t = e.target.value.trim();
          onChange(t === "" ? undefined : t);
        }}
      />
    </div>
  );
}
