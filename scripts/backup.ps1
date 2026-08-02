<#
.SYNOPSIS
    Backup semanal do banco do Segundo Cérebro (Supabase/Postgres).

.DESCRIPTION
    Gera um dump comprimido em formato CUSTOM (-Fc) e o guarda FORA da pasta do
    OneDrive. Nada é enviado para lugar nenhum; nada é apagado do banco.

    ============================================================================
    POR QUE ESTE SCRIPT EXISTE
    ============================================================================
    O plano gratuito do Supabase NÃO tem point-in-time recovery. O que existe é
    um backup diário do provedor, com retenção curta, que você não controla e
    nunca testou restaurar. Um `drop table` errado no SQL Editor às 23h de um
    sábado é irreversível dentro dessa configuração.

    ============================================================================
    POR QUE FORA DO ONEDRIVE — a parte que parece exagero e não é
    ============================================================================
    O projeto inteiro mora em
    `C:\Users\<você>\OneDrive\Documentos\...\segundo-cerebro`, e o OneDrive
    SINCRONIZA. Um dump gravado ali:

      1. sobe para a nuvem da Microsoft, sozinho, sem você decidir. O dump
         contém o Cofre inteiro (cifrado, mas presente), os refresh tokens
         cifrados do Google e todo o Financeiro. Backup é a cópia mais completa
         que existe dos seus dados — é o último arquivo que deveria sincronizar
         para um lugar por acidente;
      2. some junto no cenário que mais importa. Ransomware e "apaguei a pasta
         errada" propagam para o OneDrive em segundos, porque é isso que
         sincronização faz. Backup que mora no mesmo volume que o original é
         cópia, não backup.

    O destino padrão é `%LOCALAPPDATA%`, que o OneDrive não toca. Melhor ainda é
    um disco externo: passe -Destino.

.PARAMETER Destino
    Pasta onde o dump é gravado. Padrão: %LOCALAPPDATA%\segundo-cerebro-backups

.PARAMETER Reter
    Quantos dumps manter. Padrão: 8 (dois meses de backup semanal).

.EXAMPLE
    .\scripts\backup.ps1
    .\scripts\backup.ps1 -Destino E:\backups\segundo-cerebro -Reter 12

.NOTES
    NÃO EXECUTADO por quem escreveu este arquivo — é você quem roda.
    Pré-requisitos e procedimento de restauração: docs/backup-e-restore.md
#>

[CmdletBinding()]
param(
    [string]$Destino = (Join-Path $env:LOCALAPPDATA "segundo-cerebro-backups"),
    [int]$Reter = 8
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# 1. A URL de conexão
#
# Vem de SUPABASE_DB_URL no ambiente. NUNCA como parâmetro do script: argumento
# de linha de comando entra no histórico do PowerShell e é visível na lista de
# processos para qualquer usuário da máquina — e esta string contém a senha do
# banco com privilégio total.
# ---------------------------------------------------------------------------
$urlDoBanco = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($urlDoBanco)) {
    Write-Error @"
SUPABASE_DB_URL não está definida.

Pegue a URI em: Supabase -> Project Settings -> Database -> Connection string -> URI
Use a porta 5432 (conexão direta), não a 6543 do pooler: o pgbouncer em modo
transaction não suporta o que o pg_dump precisa.

Defina para a sessão atual:
    `$env:SUPABASE_DB_URL = 'postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres'

Ou de forma permanente, só para o seu usuário:
    [Environment]::SetEnvironmentVariable('SUPABASE_DB_URL','postgresql://...','User')
"@
}

# ---------------------------------------------------------------------------
# 2. O pg_dump
#
# A VERSÃO IMPORTA e é o erro mais comum aqui: um pg_dump mais ANTIGO que o
# servidor recusa a conexão com "server version mismatch" e não gera nada. O
# Supabase hoje roda Postgres 15+; use o pg_dump 15 ou mais novo.
# ---------------------------------------------------------------------------
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
    Write-Error @"
pg_dump não foi encontrado no PATH.

Instale as ferramentas de linha de comando do PostgreSQL:
    winget install PostgreSQL.PostgreSQL.16

e reabra o terminal (o instalador acrescenta ao PATH).
"@
}

# ---------------------------------------------------------------------------
# 3. Destino
#
# O aviso é ativo: se o destino estiver dentro do OneDrive, o script PARA. Ver
# o cabeçalho para o porquê. É a única checagem aqui que recusa em vez de
# avisar, porque um backup no lugar errado parece funcionar — o arquivo existe,
# o script diz "pronto" — e só falha no dia em que for necessário.
# ---------------------------------------------------------------------------
if (-not (Test-Path $Destino)) {
    New-Item -ItemType Directory -Force -Path $Destino | Out-Null
}
$destinoAbsoluto = (Resolve-Path $Destino).Path

if ($destinoAbsoluto -like "*OneDrive*" -or ($env:OneDrive -and $destinoAbsoluto.StartsWith($env:OneDrive, [StringComparison]::OrdinalIgnoreCase))) {
    Write-Error @"
O destino está dentro do OneDrive: $destinoAbsoluto

Um dump ali sobe para a nuvem sozinho (ele contém o Cofre e os tokens do
Google) e some junto com o original em caso de ransomware ou exclusão
acidental, porque é isso que sincronização faz.

Escolha outro lugar:
    .\scripts\backup.ps1 -Destino `$env:LOCALAPPDATA\segundo-cerebro-backups
    .\scripts\backup.ps1 -Destino E:\backups\segundo-cerebro
"@
}

$carimbo = Get-Date -Format "yyyy-MM-dd_HHmm"
$arquivo = Join-Path $destinoAbsoluto "segundo-cerebro_$carimbo.dump"
$parcial = "$arquivo.parcial"

Write-Host "Destino: $destinoAbsoluto"
Write-Host "Gerando dump..."

# ---------------------------------------------------------------------------
# 4. O dump
#
# -Fc (custom): comprimido, e restaurável SELETIVAMENTE por pg_restore — dá
#     para trazer de volta UMA tabela sem tocar no resto, que é o caso real de
#     "apaguei as tarefas sem querer". Um .sql de texto obriga a restaurar tudo
#     ou a editar o arquivo à mão.
# --no-owner / --no-privileges: o dump é restaurado sob outro papel (o seu, ou
#     um projeto Supabase novo), e os donos/grants do original não existem lá.
#     Sem isto, o pg_restore enche a saída de erros de papel inexistente.
# -n public: só o schema da aplicação. `auth`, `storage` e `extensions` são
#     geridos pelo Supabase e restaurá-los por cima quebra o projeto.
#
# ⚠️ O QUE ESTE DUMP **NÃO** CONTÉM:
#     - os ARQUIVOS do Drive. Eles estão no Storage (S3), não no Postgres. O
#       dump traz os metadados; os bytes não. Um restore devolve a lista de
#       arquivos com todos os downloads quebrados.
#     - os usuários do schema `auth`. Restaurar em um projeto novo exige
#       recriar o login, e os `user_id` mudam — ver docs/backup-e-restore.md.
#
# Escreve num arquivo `.parcial` e só renomeia no fim: dump interrompido pela
# metade não pode ficar parecido com backup bom. É a diferença entre descobrir
# a falha agora e descobrir na hora de restaurar.
# ---------------------------------------------------------------------------
$argumentos = @(
    "--dbname=$urlDoBanco"
    "--format=custom"
    "--no-owner"
    "--no-privileges"
    "--schema=public"
    "--file=$parcial"
)

& $pgDump @argumentos
if ($LASTEXITCODE -ne 0) {
    if (Test-Path $parcial) { Remove-Item $parcial -Force }
    Write-Error "pg_dump falhou (codigo $LASTEXITCODE). Nada foi gravado."
}

Move-Item -Path $parcial -Destination $arquivo -Force

$tamanho = [math]::Round((Get-Item $arquivo).Length / 1MB, 2)
Write-Host "OK: $arquivo ($tamanho MB)"

if ($tamanho -eq 0) {
    Write-Warning "O dump tem 0 MB. Confira a URL e se o schema public tem dados."
}

# ---------------------------------------------------------------------------
# 5. Retenção
#
# Mantém os N mais recentes. `Select-Object -Skip` sobre a lista ordenada do
# mais novo para o mais velho: o que sobra depois de pular os N primeiros é
# exatamente o que deve sair.
# ---------------------------------------------------------------------------
$antigos = Get-ChildItem -Path $destinoAbsoluto -Filter "segundo-cerebro_*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Reter

foreach ($velho in $antigos) {
    Remove-Item $velho.FullName -Force
    Write-Host "Removido (retencao $Reter): $($velho.Name)"
}

Write-Host ""
Write-Host "Backups em $destinoAbsoluto :"
Get-ChildItem -Path $destinoAbsoluto -Filter "segundo-cerebro_*.dump" |
    Sort-Object LastWriteTime -Descending |
    Format-Table Name, @{ Name = "MB"; Expression = { [math]::Round($_.Length / 1MB, 2) } }, LastWriteTime -AutoSize

Write-Host "Um backup nunca testado nao e um backup. Ver docs/backup-e-restore.md."
