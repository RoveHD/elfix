param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sdkUrl = 'https://catalog.ngc.nvidia.com/orgs/nvidia/multimedia/models/dlpp/1.5/download-file?path=RTX_Video_SDK_v1.1.0.zip'
$sdkSha256 = 'ABF4F34E2B5A618E355B0D5A0365D8ECC3DB4396E756E4C850A867E1AE2ED69E'
$cache = Join-Path $env:TEMP 'elfix-rtx-vsr-sdk-1.1.0'
$archive = Join-Path $cache 'RTX_Video_SDK_v1.1.0.zip'
$sdk = Join-Path $cache 'sdk'
$source = Join-Path $PSScriptRoot 'rtx-video-probe.cpp'
$output = Join-Path $PSScriptRoot 'out'
$exe = Join-Path $output 'rtx-video-probe.exe'
$obj = Join-Path $output 'rtx-video-probe.obj'

New-Item -ItemType Directory -Force -Path $cache, $output | Out-Null
if (Test-Path -LiteralPath $archive) {
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sdkSha256) {
        Remove-Item -LiteralPath $archive -Force
    }
}
if (-not (Test-Path -LiteralPath $archive)) {
    Write-Host 'Downloading official NVIDIA RTX Video SDK v1.1.0...'
    Invoke-WebRequest -Uri $sdkUrl -OutFile $archive
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actualHash -ne $sdkSha256) {
    throw "RTX Video SDK SHA256 mismatch: $actualHash (expected $sdkSha256)"
}

# The licensed SDK stays in the user's temporary cache; only our executable is
# created under out/. CI must publish the executable alone, never SDK contents.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($entry in $zip.Entries) {
        $relative = $entry.FullName.Replace('\', '/')
        if ($relative -match '^include/[^/]+\.h$' -or
            $relative -eq 'lib/Windows/x64/nvsdk_ngx_s.lib') {
            $destination = Join-Path $sdk ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
            $parent = Split-Path -Parent $destination
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    }
} finally {
    $zip.Dispose()
}
$header = Join-Path $sdk 'include/nvsdk_ngx_helpers_vsr.h'
$library = Join-Path $sdk 'lib/Windows/x64/nvsdk_ngx_s.lib'
if (-not (Test-Path -LiteralPath $header) -or -not (Test-Path -LiteralPath $library)) {
    throw 'Pinned SDK archive lacks the expected VSR header or x64 NGX import library.'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio Installer/vswhere.exe is required (MSVC C++ toolchain).'
}
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) {
    throw 'No Visual Studio installation with MSVC C++ tools found.'
}
$vsDevCmd = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $vsDevCmd)) {
    throw "Missing Visual Studio developer command file: $vsDevCmd"
}

$batch = Join-Path $cache 'compile-rtx-video-probe.cmd'
$include = Join-Path $sdk 'include'
$libDirectory = Join-Path $sdk 'lib/Windows/x64'
@"
@echo off
call "$vsDevCmd" -no_logo -arch=amd64
if errorlevel 1 exit /b 1
cl.exe /nologo /std:c++17 /EHsc /W4 /MT /I"$include" /Fo"$obj" /Fe"$exe" "$source" /link /LIBPATH:"$libDirectory" nvsdk_ngx_s.lib d3d11.lib dxgi.lib
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $batch -Encoding Ascii

Write-Host 'Building RTX VSR D3D11 probe with MSVC...'
& cmd.exe /d /c "`"$batch`""
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
    throw "MSVC build failed (exit code $LASTEXITCODE)."
}
Write-Host "Built: $exe"
Write-Host 'For a GPU run, place nvngx_vsr.dll from the same official SDK bin/Windows/x64/rel/ beside the executable.'
