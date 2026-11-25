# Encodes the chime WAV that make-chime.mjs writes into an MP3 with the encoder built into
# Windows (Media Foundation, through Windows.Media.Transcoding). Windows PowerShell 5.1 only:
# PowerShell 7 has no WinRT projection.
#
#   powershell -NoProfile -File roster/tools/make-chime.ps1 <in.wav> <out.mp3>
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]

$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
function Wait-Operation($operation, [Type]$result) {
  $asTask = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }
  $task = $asTask.MakeGenericMethod($result).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  $task.Result
}
function Wait-Progress($operation) {
  $asTask = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' }
  $task = $asTask.MakeGenericMethod([double]).Invoke($null, @($operation))
  $task.Wait() | Out-Null
}

$inPath = (Resolve-Path -LiteralPath $In).Path
$outFull = [System.IO.Path]::GetFullPath($Out)
$outDir = [System.IO.Path]::GetDirectoryName($outFull)
[System.IO.Directory]::CreateDirectory($outDir) | Out-Null
$source = Wait-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($inPath)) ([Windows.Storage.StorageFile])
$folder = Wait-Operation ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($outDir)) ([Windows.Storage.StorageFolder])
$target = Wait-Operation ($folder.CreateFileAsync([System.IO.Path]::GetFileName($outFull), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
# Low: 44.1 kHz mono, enough for a short chime and the smallest file.
$profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
$prepared = Wait-Operation ($transcoder.PrepareFileTranscodeAsync($source, $target, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prepared.CanTranscode) { throw "Windows cannot encode this file: $($prepared.FailureReason)" }
Wait-Progress ($prepared.TranscodeAsync())
$bytes = [System.IO.File]::ReadAllBytes($outFull)
$hash = (Get-FileHash -LiteralPath $outFull -Algorithm SHA256).Hash.ToLower()
"$($bytes.Length) bytes, sha256 $hash"
