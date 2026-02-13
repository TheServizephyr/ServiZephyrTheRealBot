param(
    [string]$Url = "",
    [ValidateSet('auto', 'chrome', 'edge')]
    [string]$Browser = "auto",
    [string]$ProfileName = "ServiZephyrKiosk",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-BrowserPath {
    param([string]$PreferredBrowser)

    $candidates = @(
        @{
            Name = "chrome"
            Paths = @(
                "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
                "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
            )
        },
        @{
            Name = "edge"
            Paths = @(
                "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
                "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
                "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
            )
        }
    )

    if ($PreferredBrowser -ne "auto") {
        $candidates = $candidates | Where-Object { $_.Name -eq $PreferredBrowser }
    }

    foreach ($candidate in $candidates) {
        foreach ($path in $candidate.Paths) {
            if (Test-Path -LiteralPath $path) {
                return @{
                    Name = $candidate.Name
                    Path = $path
                }
            }
        }
    }

    throw "No supported browser found. Install Google Chrome or Microsoft Edge."
}

if ([string]::IsNullOrWhiteSpace($Url)) {
    if (-not [string]::IsNullOrWhiteSpace($env:SERVIZEPHYR_KIOSK_URL)) {
        $Url = $env:SERVIZEPHYR_KIOSK_URL
    } else {
        $Url = "http://localhost:3000/owner-dashboard/custom-bill"
    }
}

try {
    [void][Uri]$Url
} catch {
    throw "Invalid URL: $Url"
}

$browserInfo = Get-BrowserPath -PreferredBrowser $Browser
$profileDir = Join-Path $env:LOCALAPPDATA "ServiZephyr\kiosk-browser-profile\$ProfileName"
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

$arguments = @(
    "--kiosk",
    "--kiosk-printing",
    "--disable-print-preview",
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--user-data-dir=$profileDir",
    "--app=$Url"
)

Write-Host "Browser      : $($browserInfo.Name)"
Write-Host "Executable   : $($browserInfo.Path)"
Write-Host "Profile Dir  : $profileDir"
Write-Host "Launch URL   : $Url"

if ($DryRun) {
    Write-Host "Dry run mode: launch skipped."
    Write-Host "Arguments    :"
    $arguments | ForEach-Object { Write-Host "  $_" }
    exit 0
}

Start-Process -FilePath $browserInfo.Path -ArgumentList $arguments | Out-Null
Write-Host "Kiosk browser launched with kiosk-printing."
