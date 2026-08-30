#Requires -Version 5.1
# OpenCode Skin Studio 开机自启开关。
# 登录后通过 HKCU Run 键静默启动系统托盘（tray.ps1），由托盘负责拉起/守护服务。
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-autostart.ps1 -Enable
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-autostart.ps1 -Disable
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-autostart.ps1   # 查看状态
# 也可在托盘菜单里直接勾选「开机自启」。

param(
  [switch]$Enable,
  [switch]$Disable
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'OpenCodeSkinStudio'
$trayScript = Join-Path $PSScriptRoot 'tray.ps1'

if (-not (Test-Path $trayScript)) {
  Write-Error "未找到托盘脚本：$trayScript"
  exit 1
}

if ($Enable) {
  $ps = (Get-Process -Id $PID).Path
  $val = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}"' -f $ps, $trayScript
  Set-ItemProperty -Path $RunKey -Name $RunName -Value $val
  Write-Host "[ok] 开机自启已开启：登录后由托盘静默启动并守护服务"
  Write-Host "     注册表：$RunKey\$RunName"
  Write-Host "     可在任务管理器 →「启动应用」中开关"
}
elseif ($Disable) {
  Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
  Write-Host "[ok] 开机自启已关闭"
}
else {
  $existing = Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "[status] 开机自启：已开启"
    Write-Host "         $RunName = $($existing.$RunName)"
  } else {
    Write-Host "[status] 开机自启：未开启（运行本脚本 -Enable 开启，或在托盘菜单勾选）"
  }
}
