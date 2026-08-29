import { spawnFile } from "./spawn.js";

/** 窗口合成模式：
 *  - opaque:      不透明（恢复默认）
 *  - transparent: 整窗透明 —— WS_EX_LAYERED + SetLayeredWindowAttributes。
 *    只要透明度 > 0 就启用，与模糊无关：桌面必须按透明度真实透出（用户明确要求可见性），
 *    模糊由页面内面板与壁纸垫底层承接（desktopSkin 的 sim 层 + backdrop-filter）。
 *
 *  为什么没有「真·模糊桌面」，四条路全部实测堵死，勿再重试——
 *  1) Win11 对 Electron 窗口静默忽略 SetWindowCompositionAttribute accent 3/4 与 DWM
 *     SYSTEMBACKDROP（test_wcab.ps1 实测；黄黑探针窗复测一致）；
 *  2) 根因：非 transparent BrowserWindow 的交换链不带 alpha（CDP
 *     Emulation.setDefaultBackgroundColorOverride 的 a:0 清屏色被 opaque backbuffer 丢弃），
 *     DWM 拿不到可透区域，accent 即使正确编码（Attrib=WCA_ACCENT_POLICY=19）也无从渲染；
 *  3) WS_EX_LAYERED 会被 DWM 屏蔽全部 backdrop——透明与系统毛玻璃互斥，二者只能选一，
 *     选透明（可见性优先）；
 *  4) 「服务端抓桌面垫底 + 面板糊」的替代方案同样不可用：SetWindowDisplayAffinity(
 *     WDA_EXCLUDEFROMCAPTURE) 对 GDI CopyFromScreen 无效（实测抓帧仍含本窗口内容，
 *     会形成递归反馈）；DXGI/WGC 无法从 PowerShell 轻量驱动。
 *  5) 用户建议的 Electron 原生 backgroundMaterial（等价 koffi 直调 DwmSetWindowAttribute 38）
 *     也实测不通（2026-08-29）：等长 patch OpenCode app.asar（Electron 39.8.5）注入
 *     backgroundMaterial:'acrylic' + transparent:true + backgroundColor:'#00000000'
 *     （issue #38454 配方），DWM backdrop 确实写入（attr 38 可读回，外部强写 4 也 hr=0）、
 *     WS_EX_NOREDIRECTIONBITMAP 已置位、CDP α=0 底色覆盖长驻——客户区仍渲染不透明底色，
 *     对壁纸换色/背后黄窗/材质 NONE 三重对照完全无响应。实验后已还原原厂 asar
 *     （resources/app.asar.ocskin-bak 为原厂备份）。
 *  Start Menu Acrylic Styler 能用是因为 XAML 窗口原生支持合成背景，Electron 学不来。 */
export type WindowFxMode = "opaque" | "transparent";

export function windowFxMode(alpha: number): WindowFxMode {
  return alpha < 1 ? "transparent" : "opaque";
}

export async function setWindowTransparency(
  exePath: string,
  alpha: number,
): Promise<{ windows: number; mode: WindowFxMode }> {
  const a = Math.max(0, Math.min(1, alpha));
  const mode = windowFxMode(a);
  const layeredOn = mode === "transparent";
  const alphaByte = layeredOn ? Math.round(a * 255) : 255;
  const exeLit = exePath.replace(/'/g, "''");
  const script = `
$Exe = '${exeLit}'
$AlphaByte = ${alphaByte}
$LayeredOn = $${layeredOn ? "true" : "false"}
Add-Type -Namespace OcSkin -Name Native -MemberDefinition @"
[StructLayout(LayoutKind.Sequential)]
public struct ACCENT_POLICY { public int AccentState; public int AccentFlags; public uint GradientColor; public int AnimationId; }
[StructLayout(LayoutKind.Sequential)]
public struct WCA_OPTIONS { public int Attrib; public IntPtr policy; public int size; }
[DllImport("user32.dll")] public static extern bool SetWindowCompositionAttribute(IntPtr hwnd, ref WCA_OPTIONS data);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lp);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int nIndex);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hwnd, int nIndex, int dwNewLong);
[DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
"@
$GWL_EXSTYLE = -20
$WS_EX_LAYERED = 0x00080000
$LWA_ALPHA = 0x2
$wins = New-Object System.Collections.ArrayList
$cb = [OcSkin.Native+EnumWindowsProc]{ param($h,$l)
  if ([OcSkin.Native]::IsWindowVisible($h)) {
    $p2 = 0
    [void][OcSkin.Native]::GetWindowThreadProcessId($h,[ref]$p2)
    try { $proc = Get-Process -Id $p2 -ErrorAction Stop; if ($proc.Path -and $proc.Path -ieq $Exe) { [void]$wins.Add($h) } } catch {}
  }
  return $true }
[void][OcSkin.Native]::EnumWindows($cb,[IntPtr]::Zero)
foreach($h in $wins){
  try {
    $ex = [OcSkin.Native]::GetWindowLong($h,$GWL_EXSTYLE)
    if ($LayeredOn) {
      if (($ex -band $WS_EX_LAYERED) -eq 0) {
        [void][OcSkin.Native]::SetWindowLong($h,$GWL_EXSTYLE,$ex -bor $WS_EX_LAYERED)
      }
      [void][OcSkin.Native]::SetLayeredWindowAttributes($h,0,[byte]$AlphaByte,$LWA_ALPHA)
    } else {
      # 恢复不透明：清除 layered 样式位（残留的 WS_EX_LAYERED 会挡住 DWM 合成），alpha 设回 255
      if (($ex -band $WS_EX_LAYERED) -ne 0) {
        [void][OcSkin.Native]::SetWindowLong($h,$GWL_EXSTYLE,$ex -band (-bnot $WS_EX_LAYERED))
      }
      [void][OcSkin.Native]::SetLayeredWindowAttributes($h,0,255,$LWA_ALPHA)
    }
  } catch {}
  # accent 复位（Attrib=19 = WCA_ACCENT_POLICY，state 0 清残留；Win11 对 Electron 忽略其余 state）
  try {
    $pol = New-Object OcSkin.Native+ACCENT_POLICY
    $pol.AccentState = 0
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf($pol)
    $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
      [System.Runtime.InteropServices.Marshal]::StructureToPtr($pol,$ptr,$false)
      $opt = New-Object OcSkin.Native+WCA_OPTIONS
      $opt.Attrib = 19; $opt.policy = $ptr; $opt.size = $size
      [void][OcSkin.Native]::SetWindowCompositionAttribute($h,[ref]$opt)
    } finally { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
  } catch {}
}
Write-Output $wins.Count
`;
  const stdout = await spawnFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    15000,
  );
  const windows = Number.parseInt(stdout.trim().split(/\r?\n/).pop() ?? "0", 10);
  return { windows: Number.isFinite(windows) ? windows : 0, mode };
}
