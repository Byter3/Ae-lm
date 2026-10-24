<# Install this unsigned development preview for the current Windows user.
   This unsigned package uses the current user's CEP development preference.
#>
[CmdletBinding()]
param([switch]$EnableUnsigned)
$ErrorActionPreference = 'Stop'
if (-not $EnableUnsigned) { throw 'This is an unsigned development preview. Read docs/install.md, then pass -EnableUnsigned to opt in to Adobe CEP development mode.' }
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\extension'))
$destinationRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
$destination = [IO.Path]::GetFullPath((Join-Path $destinationRoot 'studio.aelm'))
if (-not $destination.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid extension destination.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'CSXS\manifest.xml'))) { throw 'The complete Ae-lm package is required.' }
if (Test-Path -LiteralPath $destination) { throw "Ae-lm is already installed at $destination. Keep that copy until you deliberately remove or archive it; this installer will not overwrite it." }
$files = @('CSXS\manifest.xml','index.html','panel.css','panel.js','host\aelm.jsx','lib\bridge.js','lib\controller.js','lib\context.js','lib\history.js','lib\protocol.js','lib\transport.js','lib\settings.js')
function Assert-UnlinkedPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -Force -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Linked installation path rejected: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
Assert-UnlinkedPath $destinationRoot
foreach ($file in $files) {
    $source = Join-Path $sourceRoot $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing package file: $file" }
    Assert-UnlinkedPath $source
}
# Packaged builds include checksums for accidental corruption; these are not a signature.
$checksumPath = Join-Path (Split-Path -Parent $sourceRoot) 'SHA256SUMS.json'
if (Test-Path -LiteralPath $checksumPath) {
    Assert-UnlinkedPath $checksumPath
    $checksums = Get-Content -Raw -LiteralPath $checksumPath | ConvertFrom-Json
    foreach ($file in $files) {
        $entry = 'Ae-lm/extension/' + $file.Replace('\','/')
        $expected = $checksums.PSObject.Properties[$entry].Value
        $actual = (Get-FileHash -LiteralPath (Join-Path $sourceRoot $file) -Algorithm SHA256).Hash
        if (-not $expected -or $expected -ne $actual) { throw "Package checksum mismatch: $file" }
    }
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($file in $files) {
    $target = Join-Path $destination $file
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $target
}
# Explicit development-only opt-in, applying to this user's CEP11/12 hosts.
foreach ($version in @('11','12')) {
    $key = "HKCU:\Software\Adobe\CSXS.$version"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
}
Write-Output "Installed Ae-lm at $destination"
Write-Output 'When safe to save and restart After Effects, choose Window > Extensions > Ae-lm Assistant.'
Write-Output 'CEP unsigned-extension development mode is enabled for this user. See docs/install.md for restoration instructions.'
