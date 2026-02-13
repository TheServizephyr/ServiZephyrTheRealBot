$ErrorActionPreference = "Stop"

$locations = @(
    [Environment]::GetFolderPath("Startup"),
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
)

$removed = $false
foreach ($folder in $locations) {
    if (-not (Test-Path -LiteralPath $folder)) {
        continue
    }

    $shortcutPath = Join-Path $folder "ServiZephyr Kiosk Printing.lnk"
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host "Removed startup shortcut:"
        Write-Host "  $shortcutPath"
        $removed = $true
    }
}

if (-not $removed) {
    Write-Host "No kiosk startup shortcut found."
}
