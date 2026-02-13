param(
    [string]$PrinterName = ""
)

$ErrorActionPreference = "Stop"

$printers = Get-CimInstance Win32_Printer | Sort-Object Name

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
    Write-Host "Installed printers:"
    $printers | Select-Object Name, DriverName, PortName, Default | Format-Table -AutoSize
    Write-Host ""
    Write-Host "Usage:"
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/set-default-printer.ps1 -PrinterName "Your Printer Name"'
    exit 0
}

$target = $printers | Where-Object { $_.Name -eq $PrinterName } | Select-Object -First 1
if (-not $target) {
    throw "Printer not found: $PrinterName"
}

$result = Invoke-CimMethod -InputObject $target -MethodName SetDefaultPrinter
if ($result.ReturnValue -ne 0) {
    throw "Failed to set default printer. ReturnValue=$($result.ReturnValue)"
}

Write-Host "Default printer set to: $PrinterName"
