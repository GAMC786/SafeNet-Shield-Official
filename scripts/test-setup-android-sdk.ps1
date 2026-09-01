$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Exercise the Windows Android SDK setup entry point without downloading an SDK.
# The mock is invoked as a PowerShell script so the validation focuses on
# SDK-root and package handling without depending on cmd argument forwarding.

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        throw "ASSERTION FAILED: $Message"
    }
}

function Invoke-Setup(
    [string]$PowerShellPath,
    [string]$SetupScript,
    [hashtable]$EnvironmentOverrides
) {
    $environmentNames = @(
        "ANDROID_SDK_ROOT",
        "ANDROID_HOME",
        "SDKMANAGER",
        "MOCK_SDKMANAGER_LOG",
        "MOCK_SDKMANAGER_MODE"
    )
    $savedEnvironment = @{}

    foreach ($name in $environmentNames) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
    }

    try {
        foreach ($name in $environmentNames) {
            if ($EnvironmentOverrides.ContainsKey($name)) {
                [Environment]::SetEnvironmentVariable(
                    $name,
                    $EnvironmentOverrides[$name]
                )
            } else {
                [Environment]::SetEnvironmentVariable($name, $null)
            }
        }

        $output = & $PowerShellPath `
            -NoLogo `
            -NoProfile `
            -ExecutionPolicy Bypass `
            -File $SetupScript 2>&1 | Out-String

        return [PSCustomObject]@{
            ExitCode = $LASTEXITCODE
            Output = $output
        }
    } finally {
        foreach ($name in $environmentNames) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name])
        }
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$setupScript = Join-Path $PSScriptRoot "setup-android-sdk.ps1"
$variablesFile = Join-Path $projectRoot "android\variables.gradle"
$localPropertiesFile = Join-Path $projectRoot "android\local.properties"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "safenet-android-sdk-test-$([Guid]::NewGuid())"
$mockDirectory = Join-Path $testRoot "mock-sdkmanager"
$mockScript = Join-Path $mockDirectory "mock-sdkmanager.ps1"
$mockLog = Join-Path $testRoot "sdkmanager.log"
$escapedSdkRoot = Join-Path $testRoot "Android SDK with spaces"

$powerShellCommand = Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $powerShellCommand) {
    $powerShellCommand = Get-Command powershell -CommandType Application -ErrorAction SilentlyContinue
}
Assert-Condition ($null -ne $powerShellCommand) `
    "PowerShell is required to run the Windows Android SDK setup validation."
$powerShellPath = $powerShellCommand.Source

$variablesContent = Get-Content -LiteralPath $variablesFile -Raw
$compileSdkMatch = [regex]::Match(
    $variablesContent,
    '(?m)^\s*compileSdkVersion\s*=\s*([0-9]+).*$'
)
$targetSdkMatch = [regex]::Match(
    $variablesContent,
    '(?m)^\s*targetSdkVersion\s*=\s*([0-9]+).*$'
)
$buildToolsMatch = [regex]::Match(
    $variablesContent,
    "(?m)^\s*androidBuildToolsVersion\s*=\s*'([^']+)'.*$"
)
Assert-Condition ($compileSdkMatch.Success -and $targetSdkMatch.Success -and $buildToolsMatch.Success) `
    "Could not read Android SDK pins from $variablesFile."
$compileSdkVersion = $compileSdkMatch.Groups[1].Value
$targetSdkVersion = $targetSdkMatch.Groups[1].Value
$buildToolsVersion = $buildToolsMatch.Groups[1].Value

$hadLocalProperties = Test-Path -LiteralPath $localPropertiesFile -PathType Leaf
$originalLocalProperties = if ($hadLocalProperties) {
    [IO.File]::ReadAllText($localPropertiesFile)
} else {
    $null
}

try {
    New-Item -ItemType Directory -Path $mockDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $escapedSdkRoot -Force | Out-Null
    [IO.File]::WriteAllText(
        $mockScript,
        @'
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

if ($Arguments -contains "--licenses") {
    exit 0
}

if ($env:MOCK_SDKMANAGER_MODE -eq "missing") {
    # Simulate a repository/package that sdkmanager cannot make available.
    exit 0
}

$joinedArguments = ($Arguments -join " ").Trim()
$sdkRootMatch = [regex]::Match(
    $joinedArguments,
    '--sdk_root=(.+?)(?=\s+--(?:licenses|install)|$)'
)
if (-not $sdkRootMatch.Success) {
    [Console]::Error.WriteLine("mock sdkmanager did not receive --sdk_root")
    exit 2
}

$sdkRootArgument = "--sdk_root=$($sdkRootMatch.Groups[1].Value.Trim('"'))"
$sdkRoot = $sdkRootArgument.Substring("--sdk_root=".Length)
$installMatch = [regex]::Match($joinedArguments, '--install\s+(.+)$')
if (-not $installMatch.Success) {
    [Console]::Error.WriteLine("mock sdkmanager did not receive --install packages")
    exit 2
}

if (-not [string]::IsNullOrWhiteSpace($env:MOCK_SDKMANAGER_LOG)) {
    Add-Content -LiteralPath $env:MOCK_SDKMANAGER_LOG -Value "[$sdkRootArgument]"
    Add-Content -LiteralPath $env:MOCK_SDKMANAGER_LOG -Value "[--install]"
}

$packages = [regex]::Matches(
    $installMatch.Groups[1].Value,
    'platform-tools|platforms;android-[0-9]+|build-tools;[0-9.]+'
) | ForEach-Object { $_.Value }

foreach ($package in $packages) {
    if (-not [string]::IsNullOrWhiteSpace($env:MOCK_SDKMANAGER_LOG)) {
        Add-Content -LiteralPath $env:MOCK_SDKMANAGER_LOG -Value "[$package]"
    }

    switch -Regex ($package) {
        "^platform-tools$" {
            New-Item -ItemType Directory -Path (Join-Path $sdkRoot "platform-tools") -Force | Out-Null
        }
        "^platforms;android-(.+)$" {
            New-Item -ItemType Directory -Path (Join-Path $sdkRoot "platforms\android-$($Matches[1])") -Force | Out-Null
        }
        "^build-tools;(.+)$" {
            New-Item -ItemType Directory -Path (Join-Path $sdkRoot "build-tools\$($Matches[1])") -Force | Out-Null
        }
    }
}

exit 0
'@
    )

    # Use Java-properties escaping and omit both SDK environment variables.
    # This specifically protects Windows paths containing a drive-colon,
    # backslashes, and spaces.
    $escapedSdkPath = $escapedSdkRoot.Replace("\", "\\").Replace(":", "\:")
    [IO.File]::WriteAllText($localPropertiesFile, "sdk.dir=$escapedSdkPath`r`n")

    $success = Invoke-Setup $powerShellPath $setupScript @{
        SDKMANAGER = $mockScript
        MOCK_SDKMANAGER_LOG = $mockLog
        MOCK_SDKMANAGER_MODE = "success"
    }
    Assert-Condition ($success.ExitCode -eq 0) `
        "Expected the mocked SDK setup to succeed, but it exited $($success.ExitCode): $($success.Output)"
    Assert-Condition (
        $success.Output.Contains(
            "compile SDK $compileSdkVersion, target SDK $targetSdkVersion, and build-tools $buildToolsVersion"
        )
    ) `
        "Setup output did not report the pinned compile SDK, target SDK, and build-tools versions."

    $sdkmanagerLog = [IO.File]::ReadAllText($mockLog)
    $expectedArguments = @(
        "--sdk_root=$escapedSdkRoot",
        "--licenses",
        "--install",
        "platform-tools",
        "platforms;android-$compileSdkVersion",
        "build-tools;$buildToolsVersion"
    )
    if ($targetSdkVersion -ne $compileSdkVersion) {
        $expectedArguments += "platforms;android-$targetSdkVersion"
    }
    foreach ($expectedArgument in $expectedArguments) {
        Assert-Condition ($sdkmanagerLog.Contains("[$expectedArgument]")) `
            "Mock sdkmanager did not receive expected argument: $expectedArgument"
    }

    $missingSdkmanager = Invoke-Setup $powerShellPath $setupScript @{
        ANDROID_SDK_ROOT = $escapedSdkRoot
        SDKMANAGER = (Join-Path $testRoot "missing-sdkmanager.cmd")
    }
    Assert-Condition ($missingSdkmanager.ExitCode -ne 0) `
        "Expected setup to fail when sdkmanager is unavailable."
    Assert-Condition (
        $missingSdkmanager.Output -match "sdkmanager was not found" -and
        $missingSdkmanager.Output -match "Android SDK Command-line Tools" -and
        $missingSdkmanager.Output -match "SDKMANAGER" -and
        $missingSdkmanager.Output -match "PATH"
    ) "Missing-sdkmanager error did not include actionable installation and PATH remediation."

    $unavailableSdk = Join-Path $testRoot "unavailable SDK"
    New-Item -ItemType Directory -Path $unavailableSdk -Force | Out-Null
    $unavailablePackage = Invoke-Setup $powerShellPath $setupScript @{
        ANDROID_SDK_ROOT = $unavailableSdk
        SDKMANAGER = $mockScript
        MOCK_SDKMANAGER_LOG = $mockLog
        MOCK_SDKMANAGER_MODE = "missing"
    }
    Assert-Condition ($unavailablePackage.ExitCode -ne 0) `
        "Expected setup to fail when sdkmanager leaves pinned packages unavailable."
    Assert-Condition (
        $unavailablePackage.Output -match "unavailable after installation" -and
        $unavailablePackage.Output -match "platform-tools" -and
        $unavailablePackage.Output -match "Android Studio" -and
        $unavailablePackage.Output -match "exact packages" -and
        $unavailablePackage.Output -match "variables\.gradle"
    ) "Unavailable-package error did not include the package name and actionable remediation."

    Write-Host "Windows Android SDK setup validation passed."
} finally {
    if ($hadLocalProperties) {
        [IO.File]::WriteAllText($localPropertiesFile, $originalLocalProperties)
    } elseif (Test-Path -LiteralPath $localPropertiesFile) {
        Remove-Item -LiteralPath $localPropertiesFile -Force
    }

    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}