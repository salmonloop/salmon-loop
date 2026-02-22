Param(
  [string]$Version = $env:SALMONLOOP_VERSION,
  [string]$Repo = $env:SALMONLOOP_REPO,
  [string]$InstallDir = $env:SALMONLOOP_INSTALL_DIR
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Repo)) { $Repo = "salmonloop/salmon-loop" }
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = "latest" }
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "salmon-loop\\bin"
}

function Resolve-Tag([string]$Repo, [string]$Version) {
  if ($Version -ne "latest") { return $Version }
  $url = "https://api.github.com/repos/$Repo/releases/latest"
  $json = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "salmon-loop-installer" }
  return $json.tag_name
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

$tag = Resolve-Tag -Repo $Repo -Version $Version
if ([string]::IsNullOrWhiteSpace($tag)) { throw "Failed to resolve release tag" }

$asset = "salmon-loop-windows-x64.exe"
$base = "https://github.com/$Repo/releases/download/$tag"
$assetUrl = "$base/$asset"
$sumsUrl = "$base/SHA256SUMS"

$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP ("salmon-loop-install-" + [Guid]::NewGuid().ToString("N")))
try {
  $assetPath = Join-Path $tmp.FullName $asset
  $sumsPath = Join-Path $tmp.FullName "SHA256SUMS"

  Invoke-WebRequest -Uri $assetUrl -OutFile $assetPath -UseBasicParsing
  Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsPath -UseBasicParsing

  $expected = (Select-String -Path $sumsPath -Pattern ("\s" + [Regex]::Escape($asset) + "$") | Select-Object -First 1).Line.Split(" ")[0].Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($expected)) { throw "SHA256SUMS does not contain an entry for $asset" }

  $actual = Get-Sha256 -Path $assetPath
  if ($actual -ne $expected) { throw "Checksum mismatch for $asset. Expected $expected, got $actual" }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  $salmonPath = Join-Path $InstallDir "salmon-loop.exe"
  $s8pPath = Join-Path $InstallDir "s8p.exe"

  Copy-Item -Force -Path $assetPath -Destination $salmonPath
  Copy-Item -Force -Path $assetPath -Destination $s8pPath

  Write-Host "Installed:"
  Write-Host "  $salmonPath"
  Write-Host "  $s8pPath"
  Write-Host ""
  Write-Host "Add to PATH if needed:"
  Write-Host "  $InstallDir"
} finally {
  Remove-Item -Recurse -Force $tmp.FullName
}

