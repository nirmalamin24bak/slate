# psql on Windows without installing Postgres.
#
#   $env:SUPABASE_DB_URL = (Read-Host 'paste the pooler URI')   # not typed inline
#   .\scripts\psql.ps1 -c "select count(*) from ingredients"
#   .\scripts\psql.ps1 -f supabase/seed/02_dishes.sql
#
# Why a script: the launch gate (docs/launch-gate.md) and the ops checklist
# (docs/ops-verification.md) both ask you to run SQL against the live project —
# row counts after a restore, pg_cron liveness, the reaper's revoked EXECUTE.
# There is no psql on this machine and no reason to install one; Docker is
# already required for scripts/db-migration-test.mjs.
#
# The connection string carries the database password, so it is read from the
# environment and never written anywhere. Set it with Read-Host as above so the
# value does not land in PSReadLine history. It lives only in this shell session.
#
# Arguments pass straight through to psql. A -f path is resolved relative to the
# repo root, which is mounted read-only at /repo inside the container.

$ErrorActionPreference = 'Stop'

if (-not $env:SUPABASE_DB_URL) {
    Write-Error @'
SUPABASE_DB_URL is not set in this shell. Set it without typing the value inline:

    $env:SUPABASE_DB_URL = (Read-Host 'paste the pooler URI')

The session pooler string, not the direct one - see docs/launch-gate.md 0.2:
    postgresql://postgres.<ref>:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
'@
}

$repo = Split-Path -Parent $PSScriptRoot
$image = 'postgres:15-alpine'

# `docker images -q` rather than `image inspect`: inspect writes to stderr when
# the image is absent, and PowerShell turns a native command's stderr into a
# terminating error under ErrorActionPreference Stop. This prints nothing and
# exits 0 either way.
if (-not (docker images -q $image)) {
    Write-Host "pulling $image (one time, ~80 MB)"
    docker pull -q $image | Out-Null
}

# -i so stdin works for a heredoc; --rm so nothing is left behind. The URL goes
# in as an env var rather than an argument so it is not visible in `docker ps`
# or in the daemon's command line for other users on the machine.
$dockerArgs = @(
    'run', '--rm', '-i',
    '-e', 'PGURL',
    '-v', "${repo}:/repo:ro",
    '-w', '/repo',
    $image,
    'sh', '-c'
)

# psql reads the URL from PGURL inside the shell, and "$@" forwards our args.
$inner = 'exec psql "$PGURL" "$@"'

$env:PGURL = $env:SUPABASE_DB_URL
try {
    & docker @dockerArgs $inner 'psql' @args
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:\PGURL -ErrorAction SilentlyContinue
}
