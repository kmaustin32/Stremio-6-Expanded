param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(?:custom-v\d+\.\d+\.\d+|v\d+\.\d+\.\d+-custom\.[1-9]\d*)$')]
    [string] $Tag,
    [switch] $SmokeTest
)

$ErrorActionPreference = 'Stop'
if ($SmokeTest -and $env:CI -ne 'true') {
    throw 'Installer install/uninstall tests require an isolated CI account. Omit -SmokeTest to build packages locally.'
}
$version = $Tag -replace '^(?:custom-)?v', ''
$prefix = "Stremio-6-Expanded-$version-x64"
$payload = (New-Item -ItemType Directory -Path 'preview-payload').FullName
$out = (New-Item -ItemType Directory -Path 'preview-output').FullName

Copy-Item 'target/x86_64-pc-windows-msvc/release/stremio-shell-ng.exe' (Join-Path $payload 'Stremio 6 Expanded.exe')
Copy-Item 'libmpv-2.dll', 'server.js', 'README.md' $payload
Copy-Item -Path 'bin/*' -Destination $payload

$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
if (!(Test-Path -LiteralPath $iscc)) {
    if ($env:CI -ne 'true') { throw 'Install Inno Setup 6 before building Windows packages.' }
    choco install innosetup --no-progress -y
    if ($LASTEXITCODE) { throw "Could not install Inno Setup ($LASTEXITCODE)." }
}
& $iscc "/DPayloadDir=$payload" "/DPreviewVersion=$version" "/O$out" 'setup/Stremio-6-Expanded.iss'
if ($LASTEXITCODE) { throw "Installer compilation failed ($LASTEXITCODE)." }

$zip = Join-Path $out "$prefix.zip"
Compress-Archive -Path "$payload/*" -DestinationPath $zip
if ($SmokeTest) {
$portable = Join-Path $env:RUNNER_TEMP 'stremio-6-expanded-portable'
Expand-Archive -Path $zip -DestinationPath $portable

function Compare-Payload([string] $Directory) {
    foreach ($item in Get-ChildItem -LiteralPath $payload -File) {
        $copy = Join-Path $Directory $item.Name
        if ((Get-FileHash -LiteralPath $copy).Hash -ne (Get-FileHash -LiteralPath $item.FullName).Hash) {
            throw "Packaged file differs from the build: $($item.Name)"
        }
    }
}

function Start-And-Check([string] $Directory, [string] $Executable = 'Stremio 6 Expanded.exe', [switch] $CheckControls) {
    $previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $profile = if ($CheckControls) { 'stremio-expanded-controls-profile' } else { 'stremio-6-expanded-test-profile' }
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:RUNNER_TEMP $profile
    $appArguments = @('--no-splash', '--start-hidden')
    $app = $null
    try {
        if ($CheckControls) {
            $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
            $portProbe.Start()
            $debugPort = $portProbe.LocalEndpoint.Port
            $portProbe.Stop()
            $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$debugPort --disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
            $appArguments = @('--no-splash')
        }
        $app = Start-Process -FilePath (Join-Path $Directory $Executable) -ArgumentList $appArguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru
        $deadline = (Get-Date).AddSeconds(45)
        do {
            $app.Refresh()
            if ($app.HasExited) { throw "The packaged application exited during startup ($($app.ExitCode))." }
            $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($app.Id) AND Name = 'stremio-runtime.exe'"
            if ($child) {
                $listeners = Get-NetTCPConnection -OwningProcess $child.ProcessId -State Listen -ErrorAction SilentlyContinue
                if ($listeners) {
                    if ($CheckControls) {
                        node tests/packaged-expanded-tools.cjs $debugPort $Directory $version
                        if ($LASTEXITCODE) { throw 'Packaged Settings and Playback Tools failed.' }
                    }
                    return
                }
            }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        throw 'The packaged streaming server did not start listening.'
    } finally {
        if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id; $app.WaitForExit() }
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
        Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER
    }
}

Compare-Payload $portable
if ((Get-Item (Join-Path $portable 'Stremio 6 Expanded.exe')).VersionInfo.ProductName -ne 'Stremio 6 Expanded') {
    throw 'The executable product name did not change.'
}
Start-And-Check $portable -CheckControls

$install = Join-Path $env:LOCALAPPDATA 'Programs/Stremio 6 Expanded'
$installer = Join-Path $out "$prefix-Setup.exe"
$process = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode) { throw "Installer smoke test failed ($($process.ExitCode))." }
Compare-Payload $install
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Stremio 6 Expanded.lnk'
if (!(Test-Path -LiteralPath $shortcut)) { throw 'The renamed Start menu shortcut is missing.' }
Start-And-Check $install
$uninstall = Start-Process -FilePath (Join-Path $install 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -Wait -PassThru
if ($uninstall.ExitCode -or (Test-Path -LiteralPath (Join-Path $install 'Stremio 6 Expanded.exe'))) {
    throw 'Installer uninstall smoke test failed.'
}

# Exercise the previous installer identity and executable name in an isolated CI account.
$legacyRoot = (New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'expanded-legacy-upgrade')).FullName
$legacySetup = Join-Path $legacyRoot 'legacy.iss'
$legacyInstall = Join-Path $env:LOCALAPPDATA 'Programs/Stremio6-Custom'
@"
[Setup]
AppId={{A73EA706-283D-4D1F-9580-2EFE5349F72D}
AppName=Stremio6-Custom
AppVersion=5.0.30
DefaultDirName=$legacyInstall
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
OutputBaseFilename=legacy-setup
[Files]
Source: "$payload\Stremio 6 Expanded.exe"; DestDir: "{app}"; DestName: "Stremio6-Custom.exe"
[Icons]
Name: "{userprograms}\Stremio6-Custom"; Filename: "{app}\Stremio6-Custom.exe"
"@ | Set-Content -LiteralPath $legacySetup -Encoding utf8
& $iscc "/O$legacyRoot" $legacySetup
if ($LASTEXITCODE) { throw 'The legacy installer fixture did not compile.' }
$legacy = Start-Process -FilePath (Join-Path $legacyRoot 'legacy-setup.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -WindowStyle Hidden -Wait -PassThru
if ($legacy.ExitCode) { throw 'The legacy installer fixture did not install.' }
$profileMarker = Join-Path $legacyInstall 'Stremio6-Custom.exe.WebView2/upgrade-test.txt'
New-Item -ItemType Directory -Path (Split-Path $profileMarker) | Out-Null
'preserve-browser-profile' | Set-Content -LiteralPath $profileMarker
$upgrade = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -WindowStyle Hidden -Wait -PassThru
if ($upgrade.ExitCode) { throw 'Upgrade from the previous installer identity failed.' }
Compare-Payload $legacyInstall
if ((Get-Content -LiteralPath $profileMarker) -ne 'preserve-browser-profile') { throw 'The existing browser profile was overwritten.' }
if (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Stremio6-Custom.lnk')) { throw 'The old Start menu shortcut was not replaced.' }
$target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
if ($target -ne (Join-Path $legacyInstall 'Stremio 6 Expanded.exe')) { throw 'The new shortcut does not target the upgraded installation.' }
if ((Get-FileHash (Join-Path $legacyInstall 'Stremio6-Custom.exe')).Hash -ne (Get-FileHash (Join-Path $payload 'Stremio 6 Expanded.exe')).Hash) {
    throw 'An existing pinned shortcut would launch an outdated executable.'
}
Start-And-Check $legacyInstall
Start-And-Check $legacyInstall 'Stremio6-Custom.exe'
$uninstall = Start-Process -FilePath (Join-Path $legacyInstall 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -Wait -PassThru
if ($uninstall.ExitCode) { throw 'Upgraded installation did not uninstall.' }
}

$checksums = Get-ChildItem -LiteralPath $out -File | ForEach-Object {
    "$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant())  $($_.Name)"
}
$checksums | Set-Content -Encoding ascii (Join-Path $out 'SHA256SUMS.txt')
