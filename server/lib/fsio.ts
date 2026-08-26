import fs from "node:fs";
import path from "node:path";

export function writeFileAtomic(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, data, "utf8");
  try {
    JSON.parse(data);
  } catch {
    fs.rmSync(tmp, { force: true });
    throw new Error("refusing atomic write of invalid JSON");
  }
  fs.renameSync(tmp, filePath);
}

export function readJsonSafe<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}
