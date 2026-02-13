param(
    [string]$Url = "",
    [ValidateSet('auto', 'chrome', 'edge')]
    [string]$Browser = "auto",
    [string]$ProfileName = "ServiZephyrKiosk",
    [switch]$AllUsers
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "launch-kiosk-printing.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Missing launcher script: $scriptPath"
}

if ($AllUsers) {
    $startupFolder = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
} else {
    $startupFolder = [Environment]::GetFolderPath("Startup")
}

if (-not (Test-Path -LiteralPath $startupFolder)) {
    throw "Startup folder not found: $startupFolder"
}

$shortcutPath = Join-Path $startupFolder "ServiZephyr Kiosk Printing.lnk"
$targetPath = "powershell.exe"

$argList = @(
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`"",
    "-Browser", $Browser,
    "-ProfileName", "`"$ProfileName`""
)

if (-not [string]::IsNullOrWhiteSpace($Url)) {
    $argList += @("-Url", "`"$Url`"")
}

$arguments = $argList -join " "

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = (Split-Path -Path $scriptPath -Parent)
$shortcut.IconLocation = "$targetPath,0"
$shortcut.Save()

Write-Host "Startup shortcut created:"
Write-Host "  $shortcutPath"
Write-Host "It will launch kiosk-printing mode automatically on Windows sign-in."
