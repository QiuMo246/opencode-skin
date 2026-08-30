#Requires -Version 5.1
# OpenCode Skin Studio 系统托盘。
# 职责：常驻托盘图标 + 守护本地服务（未运行则拉起）+ 开机自启开关 + 快捷打开工作台。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tray.ps1 [-Port 5175]
# 自启：托盘菜单勾选，或 scripts\setup-autostart.ps1 -Enable（写 HKCU Run 键，登录后静默启动本脚本）。

param(
  [int]$Port = 5175
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 单实例：重复启动直接退出，避免出现两个托盘图标
$mutex = New-Object System.Threading.Mutex($false, 'Local\oc-skin-studio-tray')
if (-not $mutex.WaitOne(0)) { exit 0 }

$script:Base = Split-Path -Parent $PSScriptRoot
$script:HealthUrl = "http://127.0.0.1:$Port/api/health"
$script:RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$script:RunName = 'OpenCodeSkinStudio'
$script:ServerProc = $null
$script:LastUp = $null

function Get-ServerUp {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $script:HealthUrl -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Start-Server {
  if (Get-ServerUp) { return $true }
  # 未安装（无 dist）时走 start.bat 的标准安装流程，需要可见窗口
  if (-not (Test-Path (Join-Path $script:Base 'dist\index.html'))) {
    Start-Process -FilePath (Join-Path $script:Base 'start.bat') -WorkingDirectory $script:Base
    return $false
  }
  $script:ServerProc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' `
    -WorkingDirectory $script:Base -WindowStyle Hidden -PassThru
  return $true
}

function Stop-Server {
  # 先停自己拉起的进程树；服务若由外部启动（npm start / dev），按端口找到宿主再停
  if ($script:ServerProc -and -not $script:ServerProc.HasExited) {
    taskkill /PID $script:ServerProc.Id /T /F 2>$null | Out-Null
  }
  $script:ServerProc = $null
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($conn) { taskkill /PID $conn.OwningProcess /T /F 2>$null | Out-Null }
  } catch { }
}

function Get-Autostart {
  return ($null -ne (Get-ItemProperty -Path $script:RunKey -Name $script:RunName -ErrorAction SilentlyContinue))
}

function Set-Autostart([bool]$On) {
  if ($On) {
    $ps = (Get-Process -Id $PID).Path
    $val = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -Port {2}' -f `
      $ps, (Join-Path $PSScriptRoot 'tray.ps1'), $Port
    Set-ItemProperty -Path $script:RunKey -Name $script:RunName -Value $val
  } else {
    Remove-ItemProperty -Path $script:RunKey -Name $script:RunName -ErrorAction SilentlyContinue
  }
}

function New-TrayIcon([System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($color)), 1, 1, 30, 30)
  $font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString('OC', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 3, 32, 26)), $fmt)
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $bmp.Dispose()
  return $icon
}

$script:IcoUp = New-TrayIcon ([System.Drawing.Color]::FromArgb(136, 192, 208))   # 主题 accent #88c0d0
$script:IcoDown = New-TrayIcon ([System.Drawing.Color]::FromArgb(191, 97, 106))  # #bf616a

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Text = 'OpenCode Skin Studio'
$tray.Icon = $script:IcoDown
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('打开工作台', $null, {
  Start-Process "http://127.0.0.1:$Port"
})
$miStart = $menu.Items.Add('启动服务')
$miStart.Add_Click({
  if (Start-Server) { $tray.ShowBalloonTip(2000, 'OpenCode Skin Studio', '服务已启动', 'Info') }
})
$miStop = $menu.Items.Add('停止服务')
$miStop.Add_Click({
  Stop-Server
  $tray.ShowBalloonTip(2000, 'OpenCode Skin Studio', '服务已停止', 'Info')
})
[void]$menu.Items.Add('-')
$script:miAuto = $menu.Items.Add('开机自启')
$script:miAuto.Add_Click({
  $next = -not (Get-Autostart)
  Set-Autostart $next
  Update-AutoMenu
  $state = @{ $true = '已开启'; $false = '已关闭' }[$next]
  $tray.ShowBalloonTip(2000, 'OpenCode Skin Studio', "开机自启$state", 'Info')
})
[void]$menu.Items.Add('-')
[void]$menu.Items.Add('退出', $null, {
  # 只在服务由本托盘拉起时随退出停止；外部启动的服务保持原状
  if ($script:ServerProc -and -not $script:ServerProc.HasExited) { Stop-Server }
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu
# 左键单击 = 打开工作台（Click 事件的 EventArgs 无 Button 信息，须用 MouseUp）
$tray.Add_MouseUp({
  if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    Start-Process "http://127.0.0.1:$Port"
  }
})

function Update-AutoMenu {
  $state = @{ $true = '☑'; $false = '☐' }[(Get-Autostart)]
  $script:miAuto.Text = "开机自启 $state"
}

function Update-Status([bool]$up) {
  $tray.Icon = @{ $true = $script:IcoUp; $false = $script:IcoDown }[$up]
  $state = @{ $true = '运行中'; $false = '未运行' }[$up]
  $tray.Text = "OpenCode Skin Studio — $state"
  $miStart.Enabled = -not $up
  $miStop.Enabled = $up
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
  $up = Get-ServerUp
  if ($up -ne $script:LastUp) {
    Update-Status $up
    if ($script:LastUp -ne $null) {
      $msg = @{ $true = '服务已就绪 (127.0.0.1:' + $Port + ')'; $false = '服务未响应' }[$up]
      $tray.ShowBalloonTip(2000, 'OpenCode Skin Studio', $msg, 'Info')
    }
    $script:LastUp = $up
  }
})
$timer.Start()

Update-AutoMenu
# 启动即守护：服务没起就拉起（首启不发气泡，等首轮 tick 统一刷新状态）
[void](Start-Server)
$script:LastUp = Get-ServerUp
Update-Status $script:LastUp

[System.Windows.Forms.Application]::Run()
