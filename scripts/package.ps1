# 打包发布 zip：源码包，用户侧 npm install && npm run build && npm start
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$outDir = Join-Path $root "release"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zip = Join-Path $outDir "opencode-skin-studio-v$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Write-Host "[1/2] verifying build..."
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "tsc failed" }
if (-not (Test-Path (Join-Path $root "dist\index.html"))) {
  Write-Host "      dist missing, building..."
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

Write-Host "[2/2] creating $zip ..."
$staging = Join-Path $env:TEMP "ocskin-pkg-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  $dirs = @("server", "src", "dist", "docs", "scripts")
  foreach ($d in $dirs) {
    if (Test-Path (Join-Path $root $d)) {
      Copy-Item (Join-Path $root $d) (Join-Path $staging $d) -Recurse
    }
  }
  $files = @("package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html", "start.bat", "README.md", ".gitignore")
  foreach ($f in $files) {
    if (Test-Path (Join-Path $root $f)) {
      Copy-Item (Join-Path $root $f) (Join-Path $staging $f)
    }
  }
  Compress-Archive -Path "$staging\*" -DestinationPath $zip -Force
} finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

$size = "{0:N1} KB" -f ((Get-Item $zip).Length / 1KB)
Write-Host "done: $zip ($size)"
