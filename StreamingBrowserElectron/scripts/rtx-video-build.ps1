param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sdkUrl = 'https://catalog.ngc.nvidia.com/orgs/nvidia/multimedia/models/dlpp/1.5/download-file?path=RTX_Video_SDK_v1.1.0.zip'
$sdkSha256 = 'ABF4F34E2B5A618E355B0D5A0365D8ECC3DB4396E756E4C850A867E1AE2ED69E'
$cache = Join-Path $env:TEMP 'elfix-rtx-vsr-sdk-1.1.0'
$archive = Join-Path $cache 'RTX_Video_SDK_v1.1.0.zip'
$sdk = Join-Path $cache 'sdk'
$project = Split-Path -Parent $PSScriptRoot
$source = Join-Path $project 'native/rtx-video/rtx-video-helper.cpp'
$output = Join-Path $project 'build/rtx-video'
$exe = Join-Path $output 'rtx-video-helper.exe'
$obj = Join-Path $output 'rtx-video-helper.obj'

New-Item -ItemType Directory -Force -Path $cache, $output | Out-Null
if ((Test-Path -LiteralPath $archive) -and
    (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sdkSha256) {
    Remove-Item -LiteralPath $archive -Force
}
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $sdkUrl -OutFile $archive
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actualHash -ne $sdkSha256) {
    throw "RTX Video SDK SHA256 mismatch: $actualHash (expected $sdkSha256)"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
$found = @{}
try {
    foreach ($entry in $zip.Entries) {
        $relative = $entry.FullName.Replace('\', '/')
        $destination = $null
        if ($relative -match '^include/[^/]+\.h$' -or
            $relative -eq 'lib/Windows/x64/nvsdk_ngx_s.lib') {
            $destination = Join-Path $sdk ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
        } elseif ($relative -eq 'bin/Windows/x64/rel/nvngx_vsr.dll') {
            $destination = Join-Path $output 'nvngx_vsr.dll'
        } elseif ($relative -eq 'NVIDIA_RTX_Video_SDK_License.pdf') {
            $destination = Join-Path $output 'NVIDIA_RTX_Video_SDK_License.pdf'
        }
        if ($destination) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
            $found[$relative] = $true
        }
    }
} finally {
    $zip.Dispose()
}
foreach ($required in @('include/nvsdk_ngx_helpers_vsr.h',
                         'lib/Windows/x64/nvsdk_ngx_s.lib',
                         'bin/Windows/x64/rel/nvngx_vsr.dll',
                         'NVIDIA_RTX_Video_SDK_License.pdf')) {
    if (-not $found.ContainsKey($required)) { throw "SDK archive lacks $required" }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'MSVC C++ toolchain not found (vswhere.exe).' }
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) { throw 'MSVC C++ tools are required.' }
$vsDevCmd = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $vsDevCmd)) { throw "Missing $vsDevCmd" }
$include = Join-Path $sdk 'include'
$libDirectory = Join-Path $sdk 'lib/Windows/x64'
$batch = Join-Path $cache 'compile-rtx-video-helper.cmd'
@"
@echo off
call "$vsDevCmd" -no_logo -arch=amd64
if errorlevel 1 exit /b 1
cl.exe /nologo /std:c++17 /EHsc /W4 /MT /I"$include" /Fo"$obj" /Fe"$exe" "$source" /link /LIBPATH:"$libDirectory" nvsdk_ngx_s.lib d3d11.lib dxgi.lib advapi32.lib user32.lib
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $batch -Encoding Ascii
& cmd.exe /d /c "`"$batch`""
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
    throw "RTX helper build failed (exit code $LASTEXITCODE)."
}
Write-Host "RTX helper built: $exe"
