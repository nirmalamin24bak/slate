# psql on Windows without installing Postgres.
#
#   $env:SUPABASE_DB_URL = (Read-Host 'paste the pooler URI')   # not typed inline
#   .\scripts\psql.ps1 "select count(*) from ingredients"
#   .\scripts\psql.ps1 -Scalar "select count(*) from dishes"
#   .\scripts\psql.ps1 -File supabase/seed/02_dishes.sql -SingleTransaction
#
# Why a script: the launch gate (docs/launch-gate.md) and the ops checklist
# (docs/ops-verification.md) both ask you to run SQL against the live project —
# row counts after a restore, pg_cron liveness, the reaper's revoked EXECUTE.
# There is no psql on this machine and no reason to install one; Docker is
# already a hard requirement for scripts/db-migration-test.mjs.
#
# The connection string carries the database password, so it is read from the
# environment and never written anywhere. Set it with Read-Host as above so the
# value does not land in PSReadLine history. It lives only in this shell session.
#
# SQL goes in over stdin and the connection goes in as libpq PG* variables, so
# neither ever appears as a command-line argument. That is not only for secrecy:
# PowerShell 5.1's native-command argument passing mangles anything handed to
# docker.exe — "select a, b()" arrives as three arguments and a backslash is
# eaten outright, so `-c "<sql>"` silently ran a truncated query. stdin has no
# such layer.

[CmdletBinding(DefaultParameterSetName = 'Sql')]
param(
    # SQL to run. Multiple statements are fine; psql reads to EOF.
    [Parameter(ParameterSetName = 'Sql', Position = 0, Mandatory = $true)]
    [string]$Sql,

    # A .sql file, resolved relative to the repo root.
    [Parameter(ParameterSetName = 'File', Mandatory = $true)]
    [string]$File,

    # Wrap the whole input in one transaction, so a failure part-way leaves the
    # database as it was. What the deploy job uses for the seed files.
    [switch]$SingleTransaction,

    # Unaligned, tuples-only: one bare value, for `if ((...) -ne '549')` checks.
    [switch]$Scalar
)

$ErrorActionPreference = 'Stop'

if (-not $env:SUPABASE_DB_URL) {
    throw @'
SUPABASE_DB_URL is not set in this shell. Set it without typing the value inline:

    $env:SUPABASE_DB_URL = (Read-Host 'paste the pooler URI')

The session pooler string, not the direct one - see docs/launch-gate.md 0.2:
    postgresql://postgres.<ref>:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
'@
}

$repo = Split-Path -Parent $PSScriptRoot

if ($PSCmdlet.ParameterSetName -eq 'File') {
    $path = if ([System.IO.Path]::IsPathRooted($File)) { $File } else { Join-Path $repo $File }
    if (-not (Test-Path -LiteralPath $path)) { throw "No such file: $path" }
    $Sql = Get-Content -LiteralPath $path -Raw
}

# Split the URI into libpq variables rather than passing it as a conninfo
# argument. psql picks these up with no argument at all, which keeps the
# password out of `docker ps` and out of the daemon's process list.
try {
    $uri = [System.Uri]$env:SUPABASE_DB_URL
}
catch {
    throw "SUPABASE_DB_URL is not a valid URI. Percent-encode any of @ : / ? # [ ] % or a space in the password (@ is %40, # is %23, % is %25)."
}
if ($uri.Scheme -notin @('postgres', 'postgresql')) {
    throw "SUPABASE_DB_URL scheme is '$($uri.Scheme)', expected postgresql://"
}
$userInfo = $uri.UserInfo -split ':', 2
if ($userInfo.Count -lt 2 -or -not $userInfo[0]) {
    throw 'SUPABASE_DB_URL has no user:password. Expected postgresql://postgres.<ref>:<PASSWORD>@<host>:5432/postgres'
}

# UnescapeDataString so a percent-encoded password reaches libpq as the real
# bytes. Uri leaves UserInfo escaped; PGPASSWORD is not a URI and must not be.
$vars = @{
    PGUSER     = [System.Uri]::UnescapeDataString($userInfo[0])
    PGPASSWORD = [System.Uri]::UnescapeDataString($userInfo[1])
    PGHOST     = $uri.Host
    PGPORT     = if ($uri.Port -gt 0) { "$($uri.Port)" } else { '5432' }
    PGDATABASE = $uri.AbsolutePath.TrimStart('/')
    # Supabase terminates TLS on the pooler and rejects plaintext; be explicit
    # rather than relying on libpq's default of "prefer", which would silently
    # fall back to an unencrypted connection carrying the password.
    PGSSLMODE  = 'require'
}
if (-not $vars.PGDATABASE) { $vars.PGDATABASE = 'postgres' }

# An explicit ?sslmode= in the URI wins, so a local scratch database with no TLS
# is still reachable. Nothing else in the query string is honoured — if you need
# more libpq options than this, you want a real psql.
if ($uri.Query -match '(?:^\?|&)sslmode=([^&]+)') {
    $vars.PGSSLMODE = [System.Uri]::UnescapeDataString($Matches[1])
}

$image = 'postgres:15-alpine'
# `docker images -q` rather than `image inspect`: inspect writes to stderr when
# the image is absent, and PowerShell turns a native command's stderr into a
# terminating error under ErrorActionPreference Stop. This prints nothing and
# exits 0 either way.
if (-not (docker images -q $image)) {
    Write-Host "pulling $image (one time, ~80 MB)"
    docker pull -q $image | Out-Null
}

$dockerArgs = @('run', '--rm', '-i')
foreach ($name in $vars.Keys) { $dockerArgs += @('-e', $name) }
$dockerArgs += @('-v', "${repo}:/repo:ro", '-w', '/repo', $image, 'psql', '-v', 'ON_ERROR_STOP=1')
if ($SingleTransaction) { $dockerArgs += '--single-transaction' }
if ($Scalar) { $dockerArgs += @('-t', '-A') }

# PowerShell 5.1 pipes to a native command using $OutputEncoding, which defaults
# to a UTF-8 encoder that emits a byte-order mark. psql would read the BOM as
# part of the first token and fail with `syntax error at or near "﻿select"`.
$previousEncoding = $OutputEncoding
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
foreach ($name in $vars.Keys) { Set-Item "Env:\$name" $vars[$name] }
try {
    $Sql | & docker @dockerArgs
    exit $LASTEXITCODE
}
finally {
    $OutputEncoding = $previousEncoding
    foreach ($name in $vars.Keys) { Remove-Item "Env:\$name" -ErrorAction SilentlyContinue }
}
