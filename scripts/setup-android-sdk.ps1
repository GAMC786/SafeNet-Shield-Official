$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Install and verify the Android SDK packages required by the Gradle project.
# Keep the versions in android/variables.gradle; this script intentionally
# reads them instead of maintaining a second set of pins.

function Fail([string]$Message) {
    Write-Error "ERROR: $Message"
    exit 1
}

function Read-GradleValue(
    [string]$Content,
    [string]$Name,
    [string]$Pattern
) {
    $matches = [regex]::Matches($Content, $Pattern)
    if ($matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace($matches[0].Groups[1].Value)) {
        Fail "Could not read a single $Name from $variablesFile."
    }

    return $matches[0].Groups[1].Value
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$variablesFile = Join-Path $projectRoot "android\variables.gradle"
if (-not (Test-Path -LiteralPath $variablesFile -PathType Leaf)) {
    Fail "Android version file was not found: $variablesFile"
}

$variablesContent = Get-Content -LiteralPath $variablesFile -Raw
$compileSdkVersion = Read-GradleValue `
    $variablesContent `
    "compileSdkVersion" `
    '(?m)^\s*compileSdkVersion\s*=\s*([0-9]+).*$'
$targetSdkVersion = Read-GradleValue `
    $variablesContent `
    "targetSdkVersion" `
    '(?m)^\s*targetSdkVersion\s*=\s*([0-9]+).*$'
$buildToolsVersion = Read-GradleValue `
    $variablesContent `
    "androidBuildToolsVersion" `
    "(?m)^\s*androidBuildToolsVersion\s*=\s*'([^']+)'.*$"

if ($compileSdkVersion -notmatch '^[0-9]+$') {
    Fail "The compileSdkVersion in $variablesFile is not a valid Android API level."
}
if ($targetSdkVersion -notmatch '^[0-9]+$') {
    Fail "The targetSdkVersion in $variablesFile is not a valid Android API level."
}
if ($buildToolsVersion -notmatch '^[0-9]+([.][0-9]+){2}$') {
    Fail "The androidBuildToolsVersion in $variablesFile is not a valid version."
}

$sdkRoot = $env:ANDROID_SDK_ROOT
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    $sdkRoot = $env:ANDROID_HOME
}

if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    $localPropertiesFile = Join-Path $projectRoot "android\local.properties"
    if (Test-Path -LiteralPath $localPropertiesFile -PathType Leaf) {
        $sdkLine = Get-Content -LiteralPath $localPropertiesFile |
            Where-Object { $_ -match '^\s*sdk\.dir\s*=' } |
            Select-Object -First 1
        if ($null -ne $sdkLine -and $sdkLine -match '^\s*sdk\.dir\s*=\s*(.*?)\s*$') {
            # local.properties uses Java-properties escaping for Windows paths.
            $sdkRoot = $matches[1].Replace('\:', ':').Replace('\\', '\')
        }
    }
}

if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
    Fail "Android SDK location is not configured. Set ANDROID_SDK_ROOT (or ANDROID_HOME), or add sdk.dir to android\local.properties."
}

$sdkRoot = [Environment]::ExpandEnvironmentVariables($sdkRoot.Trim())
if (-not (Test-Path -LiteralPath $sdkRoot -PathType Container)) {
    Fail "Android SDK directory does not exist: $sdkRoot"
}

$sdkManager = $env:SDKMANAGER
if ([string]::IsNullOrWhiteSpace($sdkManager)) {
    $sdkManagerCommand = Get-Command sdkmanager.bat -ErrorAction SilentlyContinue
    if ($null -eq $sdkManagerCommand) {
        $sdkManagerCommand = Get-Command sdkmanager -ErrorAction SilentlyContinue
    }
    if ($null -ne $sdkManagerCommand) {
        $sdkManager = $sdkManagerCommand.Source
    }
}

if (-not [string]::IsNullOrWhiteSpace($sdkManager) -and
    -not (Test-Path -LiteralPath $sdkManager -PathType Leaf)) {
    $sdkManagerCommand = Get-Command $sdkManager -ErrorAction SilentlyContinue
    if ($null -ne $sdkManagerCommand) {
        $sdkManager = $sdkManagerCommand.Source
    }
}

if ([string]::IsNullOrWhiteSpace($sdkManager)) {
    $sdkManagerCandidates = @(
        (Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"),
        (Join-Path $sdkRoot "cmdline-tools\bin\sdkmanager.bat"),
        (Join-Path $sdkRoot "tools\bin\sdkmanager.bat")
    )
    foreach ($candidate in $sdkManagerCandidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $sdkManager = $candidate
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($sdkManager) -or
    (-not (Test-Path -LiteralPath $sdkManager -PathType Leaf) -and
        $null -eq (Get-Command $sdkManager -ErrorAction SilentlyContinue))) {
    Fail "sdkmanager was not found. Install Android SDK Command-line Tools from Android Studio (Tools > SDK Manager > SDK Tools), then set SDKMANAGER or add its bin directory to PATH."
}

$packages = @(
    "platform-tools",
    "platforms;android-$compileSdkVersion",
    "build-tools;$buildToolsVersion"
)
if ($targetSdkVersion -ne $compileSdkVersion) {
    $packages += "platforms;android-$targetSdkVersion"
}

Write-Host "Preparing Android SDK at $sdkRoot"
Write-Host "Required packages: $($packages -join ' ')"

# sdkmanager asks for one response per license. A generous finite input keeps
# this non-interactive while still allowing the command to report failures.
$licenseAnswers = ((1..100 | ForEach-Object { "y" }) -join [Environment]::NewLine) +
    [Environment]::NewLine
$licenseAnswers | & $sdkManager "--sdk_root=$sdkRoot" "--licenses" | Out-Host
if ($LASTEXITCODE -ne 0) {
    Fail "Android SDK licenses could not be accepted. Run sdkmanager --licenses and try again."
}

$sdkArguments = @("--sdk_root=$sdkRoot", "--install") + $packages
& $sdkManager @sdkArguments
if ($LASTEXITCODE -ne 0) {
    Fail "Could not install the required Android SDK package(s): $($packages -join ', '). In Android Studio, open Tools > SDK Manager, verify access to the Android repository, and confirm these exact pinned packages are available."
}

$missingPackages = @()
$packageDirectories = @(
    "platform-tools",
    "platforms\android-$compileSdkVersion",
    "build-tools\$buildToolsVersion"
)
if ($targetSdkVersion -ne $compileSdkVersion) {
    $packageDirectories += "platforms\android-$targetSdkVersion"
}

foreach ($packageDirectory in $packageDirectories) {
    $packagePath = Join-Path $sdkRoot $packageDirectory
    if (-not (Test-Path -LiteralPath $packagePath -PathType Container)) {
        $missingPackages += $packageDirectory
    }
}

if ($missingPackages.Count -gt 0) {
    Fail "Required Android SDK package(s) are unavailable after installation: $($missingPackages -join ', '). In Android Studio, open Tools > SDK Manager, enable the appropriate SDK repository/channel, install the exact packages, and rerun this command. Change android\variables.gradle only for an intentional toolchain update."
}

Write-Host "Android SDK is ready for compile SDK $compileSdkVersion, target SDK $targetSdkVersion, and build-tools $buildToolsVersion."