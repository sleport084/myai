param(
  [ValidateSet('app', 'backend')]
  [string]$Mode = 'app'
)

$ErrorActionPreference = 'Stop'

$env:BAILONGMA_HOST = '0.0.0.0'
$env:BAILONGMA_ALLOW_LAN = '1'

function Test-PrivateLanAddress {
  param([string]$Address)

  $parts = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $parts[0] -eq 10 -or
    ($parts[0] -eq 172 -and $parts[1] -ge 16 -and $parts[1] -le 31) -or
    ($parts[0] -eq 192 -and $parts[1] -eq 168)
}

$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.PrefixOrigin -ne 'WellKnown' -and
    (Test-PrivateLanAddress $_.IPAddress)
  } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host ''
Write-Host 'Bailongma LAN mode is enabled.'
Write-Host 'Open one of these URLs on another device connected to the same network:'
foreach ($address in $addresses) {
  Write-Host "  http://$address`:3721/"
}
Write-Host ''
Write-Host 'If the page does not open, allow Node/Electron through Windows Firewall for private networks.'
Write-Host ''

if ($Mode -eq 'backend') {
  node --env-file=.env src/index.js
} else {
  electron .
}
