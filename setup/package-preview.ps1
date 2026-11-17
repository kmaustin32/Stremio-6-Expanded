param(
    [Parameter(Mandatory)]
    [ValidatePattern('^v\d+\.\d+\.\d+-custom\.[1-9]\d*$')]
    [string] $Tag
)

$ErrorActionPreference = 'Stop'
$version = $Tag.Substring(1)
$prefix = "Stremio6-Custom-$version-x64"
$payload = (New-Item -ItemType Directory -Path 'preview-payload').FullName
$out = (New-Item -ItemType Directory -Path 'preview-output').FullName

Copy-Item 'target/x86_64-pc-windows-msvc/release/stremio-shell-ng.exe' (Join-Path $payload 'Stremio6-Custom.exe')
Copy-Item 'libmpv-2.dll', 'server.js', 'README.md' $payload
Copy-Item -Path 'bin/*' -Destination $payload

$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
if (!(Test-Path -LiteralPath $iscc)) {
    choco install innosetup --no-progress -y
    if ($LASTEXITCODE) { throw "Could not install Inno Setup ($LASTEXITCODE)." }
}
& $iscc "/DPayloadDir=$payload" "/DPreviewVersion=$version" "/O$out" 'setup/Stremio6-Custom.iss'
if ($LASTEXITCODE) { throw "Installer compilation failed ($LASTEXITCODE)." }

$zip = Join-Path $out "$prefix.zip"
Compress-Archive -Path "$payload/*" -DestinationPath $zip
$portable = Join-Path $env:RUNNER_TEMP 'stremio6-custom-portable'
Expand-Archive -Path $zip -DestinationPath $portable

function Compare-Payload([string] $Directory) {
    foreach ($item in Get-ChildItem -LiteralPath $payload -File) {
        $copy = Join-Path $Directory $item.Name
        if ((Get-FileHash -LiteralPath $copy).Hash -ne (Get-FileHash -LiteralPath $item.FullName).Hash) {
            throw "Packaged file differs from the build: $($item.Name)"
        }
    }
}

function Start-And-Check([string] $Directory) {
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:RUNNER_TEMP 'stremio6-custom-test-profile'
    $app = Start-Process -FilePath (Join-Path $Directory 'Stremio6-Custom.exe') -ArgumentList '--no-splash', '--start-hidden' -WorkingDirectory $Directory -WindowStyle Hidden -PassThru
    try {
        $deadline = (Get-Date).AddSeconds(45)
        do {
            $app.Refresh()
            if ($app.HasExited) { throw "The packaged application exited during startup ($($app.ExitCode))." }
            $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($app.Id) AND Name = 'stremio-runtime.exe'"
            if ($child) {
                $listeners = Get-NetTCPConnection -OwningProcess $child.ProcessId -State Listen -ErrorAction SilentlyContinue
                if ($listeners) { return }
            }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        throw 'The packaged streaming server did not start listening.'
    } finally {
        if (!$app.HasExited) { Stop-Process -Id $app.Id; $app.WaitForExit() }
        Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER
    }
}

Compare-Payload $portable
Start-And-Check $portable

$install = Join-Path $env:LOCALAPPDATA 'Programs/Stremio6-Custom'
$installer = Join-Path $out "$prefix-Setup.exe"
$process = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode) { throw "Installer smoke test failed ($($process.ExitCode))." }
Compare-Payload $install
Start-And-Check $install
$uninstall = Start-Process -FilePath (Join-Path $install 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -Wait -PassThru
if ($uninstall.ExitCode -or (Test-Path -LiteralPath (Join-Path $install 'Stremio6-Custom.exe'))) {
    throw 'Installer uninstall smoke test failed.'
}

$checksums = Get-ChildItem -LiteralPath $out -File | ForEach-Object {
    "$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant())  $($_.Name)"
}
$checksums | Set-Content -Encoding ascii (Join-Path $out 'SHA256SUMS.txt')
