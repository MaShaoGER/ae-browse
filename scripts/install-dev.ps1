param([switch]$EnableDebug)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$buildDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory 'dist\AE Browse'))
$extensionDirectory = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions\local.aebrowse'))
if (-not (Test-Path -LiteralPath (Join-Path $buildDirectory 'CSXS\manifest.xml'))) { throw '请先运行 node scripts/build-cep.cjs。' }
if (Test-Path -LiteralPath $extensionDirectory) { throw "目标已存在，未覆盖：$extensionDirectory。请保留原目录，再手动选择升级方式。" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $extensionDirectory) | Out-Null
Copy-Item -LiteralPath $buildDirectory -Destination $extensionDirectory -Recurse
if ($EnableDebug) {
  $debugKey = 'HKCU:\Software\Adobe\CSXS.12'
  New-Item -Path $debugKey -Force | Out-Null
  New-ItemProperty -Path $debugKey -Name PlayerDebugMode -PropertyType String -Value '1' -Force | Out-Null
}
Write-Output "开发扩展已复制到 $extensionDirectory"
Write-Output '重新打开 AE 后，在窗口 > 扩展菜单中打开 AE Browse。此脚本未启动 AE，也未修改 AE 工程。'
if (-not $EnableDebug) { Write-Output '未设置 PlayerDebugMode。未签名扩展需要对应 CEP 的开发调试设置。' }
