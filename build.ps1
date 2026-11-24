$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    cargo build --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw "Build failed ($LASTEXITCODE)." }
    $metadata = cargo metadata --no-deps --format-version 1 | ConvertFrom-Json
    if ($LASTEXITCODE) { throw 'Could not read package version.' }
    $package = $metadata.packages | Where-Object name -eq 'stremio-shell-ng'
    $tag = if ($package.version -match '-custom\.\d+$') { "v$($package.version)" } else { "custom-v$($package.version)" }
    & ./setup/package-preview.ps1 -Tag $tag
} finally {
    Pop-Location
}
