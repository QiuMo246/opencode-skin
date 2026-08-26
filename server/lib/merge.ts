export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(target: T, patch: unknown): T {
  if (!isPlainObject(target) || !isPlainObject(patch)) {
    return patch === undefined ? target : (patch as T);
  }
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}
