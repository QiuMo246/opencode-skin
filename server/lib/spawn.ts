import { spawn } from "node:child_process";

/** 运行外部命令并收集 stdout；非零退出码或超时抛错。 */
export function spawnFile(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${cmd} 执行超时`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} 退出码 ${code}`));
    });
  });
}
