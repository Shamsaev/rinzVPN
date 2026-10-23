# Скачивает ядра Xray-core и sing-box для Windows в src-tauri/cores.
# Запуск:  npm run cores   (или: powershell -ExecutionPolicy Bypass -File scripts/fetch-cores.ps1)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # иначе Invoke-WebRequest качает в разы медленнее

# Версии зафиксированы: обновляем осознанно, проверив совместимость конфигов
$XrayVersion = "v26.10.21"
$SingboxVersion = "1.14.3"

$Root = Split-Path -Parent $PSScriptRoot
$Cores = Join-Path $Root "src-tauri\cores"
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("rinzvpn-cores-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Cores, $Tmp | Out-Null

try {
    Write-Host "Xray $XrayVersion..."
    $xrayZip = Join-Path $Tmp "xray.zip"
    Invoke-WebRequest "https://github.com/XTLS/Xray-core/releases/download/$XrayVersion/Xray-windows-64.zip" -OutFile $xrayZip
    Expand-Archive $xrayZip -DestinationPath (Join-Path $Tmp "xray") -Force
    foreach ($f in "xray.exe", "geoip.dat", "geosite.dat") {
        Copy-Item (Join-Path $Tmp "xray\$f") $Cores -Force
    }

    Write-Host "sing-box $SingboxVersion..."
    $sbZip = Join-Path $Tmp "sing-box.zip"
    Invoke-WebRequest "https://github.com/SagerNet/sing-box/releases/download/v$SingboxVersion/sing-box-$SingboxVersion-windows-amd64.zip" -OutFile $sbZip
    Expand-Archive $sbZip -DestinationPath (Join-Path $Tmp "sb") -Force
    $sbDir = Join-Path $Tmp "sb\sing-box-$SingboxVersion-windows-amd64"
    foreach ($f in "sing-box.exe", "libcronet.dll") {
        Copy-Item (Join-Path $sbDir $f) $Cores -Force
    }

    & (Join-Path $Cores "xray.exe") version | Select-Object -First 1
    & (Join-Path $Cores "sing-box.exe") version | Select-Object -First 1
    Write-Host "Готово: $Cores" -ForegroundColor Green
}
finally {
    Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
