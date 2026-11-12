# Libera a porta do sistema no Firewall do Windows, somente para computadores da rede local.
# Execute com botão direito > "Executar com o PowerShell" (vai pedir permissão de administrador).
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
$porta = 3000
$linha = Get-Content (Join-Path $PSScriptRoot '.env') | Where-Object { $_ -match '^PORT=(\d+)' }
if ($linha) { $porta = [int]($linha -replace '^PORT=', '') }
# Remove também a regra do antigo projeto "Análises por Analista", que usava o mesmo nome base.
Get-NetFirewallRule -DisplayName 'Analises por Analista', 'Analises CRM' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Analises CRM' -Direction Inbound -Protocol TCP -LocalPort $porta `
  -RemoteAddress LocalSubnet -Profile Any -Action Allow | Out-Null
Write-Host "Porta $porta liberada para a rede local." -ForegroundColor Green
Read-Host 'Pressione Enter para fechar'
