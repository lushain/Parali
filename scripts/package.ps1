$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$lambdaBuild = Join-Path $repoRoot 'infra\build'
$siteBuild = Join-Path $repoRoot 'dist'
$outDir = Join-Path $repoRoot '.local\packages'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $lambdaBuild 'index.js'))) { throw 'Run npm run build:lambda first.' }
if (-not (Test-Path -LiteralPath (Join-Path $siteBuild 'index.html'))) { throw 'Run npm run build first.' }
Compress-Archive -Path (Join-Path $lambdaBuild 'index.js') -DestinationPath (Join-Path $outDir 'parali-lambda.zip') -Force
$codeHash = (Get-FileHash -LiteralPath (Join-Path $lambdaBuild 'index.js') -Algorithm SHA256).Hash.ToLower().Substring(0,12)
$versionedCode = "parali-lambda-$codeHash.zip"
Copy-Item -LiteralPath (Join-Path $outDir 'parali-lambda.zip') -Destination (Join-Path $outDir $versionedCode) -Force
python (Join-Path $PSScriptRoot 'package-site.py')
if ($LASTEXITCODE -ne 0) { throw 'Frontend archive creation failed.' }
$workerBytes = [IO.File]::ReadAllBytes((Join-Path $repoRoot 'infra\compute-worker.py'))
$workerBase64 = [Convert]::ToBase64String($workerBytes)
$template = [IO.File]::ReadAllText((Join-Path $repoRoot 'infra\template.yaml')).Replace('__PARALI_WORKER_BASE64__', $workerBase64)
$samTemplate = $template.Replace('CodeUri: build/', 'CodeUri: ./')
[IO.File]::WriteAllText((Join-Path $lambdaBuild 'template.yaml'), $samTemplate)
$manualTemplate = $template.Replace("Parameters:", "Parameters:`n  DeploymentBucket:`n    Type: String`n    Description: Private bucket containing the versioned Lambda archive`n")
$manualTemplate = $manualTemplate.Replace('CodeUri: build/', "CodeUri: {Bucket: !Ref DeploymentBucket, Key: $versionedCode}")
[IO.File]::WriteAllText((Join-Path $outDir 'parali-console-template.yaml'), $manualTemplate)
Write-Output "Deployment archives written to $outDir. They contain no .env, transcripts, setup keys or AWS credentials; the frontend includes the intentional public fixture capabilities."
