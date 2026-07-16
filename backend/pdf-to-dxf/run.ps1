# PDF -> DXF backend launcher (Windows).
#
# Like this project's build.ps1, nothing heavy is created on Google Drive:
# the Python virtual environment and the job workspace both live under
# %LOCALAPPDATA%, because pip installing into a Drive-synced folder corrupts
# packages the same way npm does. Just run:  .\run.ps1
#
# First run creates the venv and installs dependencies (a few minutes).
# Later runs start instantly. Leave the window open while you use the app;
# Ctrl+C stops the server.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$appData = $env:LOCALAPPDATA
$venv    = Join-Path $appData 'pdf2dxf-venv'
$jobs    = Join-Path $appData 'pdf2dxf-jobs'
$py      = Join-Path $venv 'Scripts\python.exe'

# locate a Python 3 interpreter
function Find-Python {
    foreach ($c in @('py -3', 'python', 'python3')) {
        $parts = $c.Split(' ')
        $exe = $parts[0]
        if (Get-Command $exe -ErrorAction SilentlyContinue) {
            try {
                & $exe $parts[1..($parts.Length-1)] --version *> $null
                if ($LASTEXITCODE -eq 0) { return $c }
            } catch {}
        }
    }
    return $null
}

if (-not (Test-Path $py)) {
    $python = Find-Python
    if (-not $python) {
        Write-Host ''
        Write-Host 'Python 3 was not found.' -ForegroundColor Red
        Write-Host 'Install it from https://www.python.org/downloads/ (tick'
        Write-Host '"Add python.exe to PATH" in the installer), then re-run .\run.ps1'
        exit 1
    }
    Write-Host "Creating Python environment in $venv ..." -ForegroundColor Cyan
    $parts = $python.Split(' ')
    & $parts[0] $parts[1..($parts.Length-1)] -m venv $venv
    & $py -m pip install --upgrade pip
    Write-Host 'Installing dependencies (first run only, a few minutes) ...' -ForegroundColor Cyan
    & $py -m pip install -r (Join-Path $here 'requirements.txt')
}

New-Item -ItemType Directory -Force -Path $jobs | Out-Null
$env:JOB_DIR = $jobs

Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host ' PDF -> DXF backend is starting.' -ForegroundColor Green
Write-Host ' When it says "Application startup complete", open the' -ForegroundColor Green
Write-Host ' app and set the backend URL to:  http://localhost:8000' -ForegroundColor Green
Write-Host ''
Write-Host ' Leave this window open while converting. Ctrl+C stops.' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host ''

Set-Location $here
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
