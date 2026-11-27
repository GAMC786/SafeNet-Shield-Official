package com.safenet.dns

import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * SafeNet-maintained configuration UI for the AppLock-Revived integration.
 * User credentials and protected-app selections remain in SafeNet's local store.
 */
internal object AppLockRevivedSetupUi {
    @JvmStatic
    fun render(activity: AppLockActivity, host: ComposeView, onSaved: Runnable) {
        host.setContent {
            AppLockRevivedTheme.Content(
                light = AppLockRevivedTheme.isLight(activity),
            ) {
                AppLockConfigurationScreen(
                    activity = activity,
                    onSaved = onSaved,
                )
            }
        }
    }
}

private data class LaunchableApp(val packageName: String, val label: String)

@Composable
private fun AppLockConfigurationScreen(
    activity: AppLockActivity,
    onSaved: Runnable,
) {
    val snapshot = remember { AppLockRevivedStateBridge.read(activity) }
    var hasPasscode by remember { mutableStateOf(snapshot.hasPasscode) }
    var protectionEnabled by remember { mutableStateOf(snapshot.enabled) }
    var protectionReady by remember { mutableStateOf(snapshot.protectionReady) }
    val selectedPackages = remember {
        mutableStateListOf<String>().apply {
            addAll(snapshot.protectedPackages)
            if (activity.packageName !in this) add(activity.packageName)
        }
    }
    var passcode by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var recoveryQuestion by remember { mutableStateOf("") }
    var recoveryAnswer by remember { mutableStateOf("") }
    var pickerVisible by remember { mutableStateOf(false) }
    var recoverySettingsVisible by remember { mutableStateOf(false) }
    var ownerInstructionsVisible by remember { mutableStateOf(false) }
    var appSearch by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf("") }
    var apps by remember { mutableStateOf<List<LaunchableApp>>(emptyList()) }

    LaunchedEffect(activity) {
        apps = withContext(Dispatchers.IO) { launchableApps(activity) }
    }

    BackHandler(enabled = pickerVisible || recoverySettingsVisible) {
        pickerVisible = false
        recoverySettingsVisible = false
        appSearch = ""
    }

    if (ownerInstructionsVisible) {
        AlertDialog(
            onDismissRequest = { ownerInstructionsVisible = false },
            title = { Text("Anti-uninstall protection") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Run this command from a computer with ADB after installing SafeNet:")
                    Text(AppLockManager.deviceOwnerProvisioningCommand(activity))
                    Text("Device Owner setup is optional and must be completed from Android.")
                }
            },
            confirmButton = {
                TextButton(onClick = { ownerInstructionsVisible = false }) {
                    Text("Done")
                }
            },
        )
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("SAFENET  /  APP LOCK", style = MaterialTheme.typography.labelMedium)
            Text("AppLock", style = MaterialTheme.typography.headlineMedium)
            Text(
                when {
                    protectionReady -> "Protection is active"
                    protectionEnabled -> "Not protecting apps — permissions needed"
                    else -> "Protection is ready to configure"
                },
                style = MaterialTheme.typography.bodyLarge,
            )

            if (recoverySettingsVisible) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("Passcode and recovery settings", style = MaterialTheme.typography.titleLarge)
                        Button(
                            onClick = {
                                activity.startActivity(
                                    Intent(activity, LockLockActivity::class.java)
                                        .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_UNLOCK)
                                        .putExtra(AppLockManager.EXTRA_START_RECOVERY_SCREEN, true)
                                )
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Forgot Passcode")
                        }
                        TextButton(
                            onClick = { recoverySettingsVisible = false },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Back to settings")
                        }
                    }
                }
            } else if (pickerVisible) {
                Text("Select Apps", style = MaterialTheme.typography.headlineSmall)
                Text("Choose launchable apps to protect with SafeNet AppLock.")
                OutlinedTextField(
                    value = appSearch,
                    onValueChange = { appSearch = it },
                    label = { Text("Search apps") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                val normalizedQuery = appSearch.trim().lowercase(Locale.ROOT)
                val filteredApps = apps.filter {
                    normalizedQuery.isEmpty()
                        || it.label.lowercase(Locale.ROOT).contains(normalizedQuery)
                        || it.packageName.lowercase(Locale.ROOT).contains(normalizedQuery)
                }
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(360.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(filteredApps, key = { it.packageName }) { app ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (app.packageName in selectedPackages) {
                                        selectedPackages.remove(app.packageName)
                                    } else {
                                        selectedPackages.add(app.packageName)
                                    }
                                }
                                .padding(horizontal = 8.dp, vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(app.label, style = MaterialTheme.typography.bodyLarge)
                                Text(app.packageName, style = MaterialTheme.typography.bodySmall)
                            }
                            Checkbox(
                                checked = app.packageName in selectedPackages,
                                onCheckedChange = { checked ->
                                    if (checked) selectedPackages.add(app.packageName)
                                    else selectedPackages.remove(app.packageName)
                                },
                                modifier = Modifier.semantics {
                                    contentDescription = "Protect ${app.label}"
                                },
                            )
                        }
                    }
                }
                Button(
                    onClick = {
                        selectedPackages.addIfMissing(activity.packageName)
                        AppLockRevivedStateBridge.saveProtectedPackages(
                            activity,
                            selectedPackages.toSet(),
                        )
                        pickerVisible = false
                        appSearch = ""
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Protect selected apps")
                }
                TextButton(
                    onClick = { pickerVisible = false; appSearch = "" },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Cancel")
                }
            } else {
                if (!hasPasscode) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text("Create your local passcode", style = MaterialTheme.typography.titleLarge)
                            Text("This passcode stays on this device and protects the apps you select.")
                            OutlinedTextField(
                                value = passcode,
                                onValueChange = { passcode = it },
                                label = { Text("New passcode") },
                                singleLine = true,
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = confirmation,
                                onValueChange = { confirmation = it },
                                label = { Text("Confirm passcode") },
                                singleLine = true,
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = recoveryQuestion,
                                onValueChange = { recoveryQuestion = it },
                                label = { Text("Recovery question") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = recoveryAnswer,
                                onValueChange = { recoveryAnswer = it },
                                label = { Text("Recovery answer") },
                                singleLine = true,
                                visualTransformation = PasswordVisualTransformation(),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Button(
                                onClick = {
                                    if (passcode != confirmation) {
                                        statusMessage = "The passcodes do not match."
                                        return@Button
                                    }
                                    try {
                                        AppLockRevivedStateBridge.configurePasscode(
                                            activity,
                                            passcode,
                                            recoveryQuestion,
                                            recoveryAnswer,
                                        )
                                        selectedPackages.addIfMissing(activity.packageName)
                                        AppLockRevivedStateBridge.saveProtectedPackages(
                                            activity,
                                            selectedPackages.toSet(),
                                        )
                                        AppLockManager.setEnabled(activity, true)
                                        hasPasscode = true
                                        protectionEnabled = true
                                        protectionReady = AppLockManager.isProtectionActive(activity)
                                        statusMessage = "Passcode saved."
                                        onSaved.run()
                                    } catch (error: IllegalArgumentException) {
                                        statusMessage = error.message ?: "The passcode could not be saved."
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Set passcode and enable AppLock")
                            }
                        }
                    }
                }

                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Protected apps", style = MaterialTheme.typography.titleLarge)
                        Text("${selectedPackages.size} apps selected")
                        selectedPackages.sorted().forEach { packageName ->
                            val appLabel = apps.firstOrNull { it.packageName == packageName }?.label
                                ?: if (packageName == activity.packageName) {
                                    activity.applicationInfo.loadLabel(activity.packageManager).toString()
                                } else {
                                    packageName
                                }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    appLabel,
                                    modifier = Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                TextButton(
                                    onClick = {
                                        AppLockManager.allowTemporaryUnlock(activity, packageName)
                                        statusMessage = "Unlocked until the next protected launch."
                                    },
                                ) {
                                    Text("Unlock")
                                }
                            }
                        }
                        Button(
                            onClick = { pickerVisible = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Add protected apps")
                        }
                        Button(
                            onClick = {
                                activity.startActivity(
                                    AppLockManager.overlayPermissionIntent(activity)
                                )
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Allow overlay")
                        }
                        Button(
                            onClick = {
                                activity.startActivity(AppLockManager.accessibilitySettingsIntent())
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Open Accessibility Settings")
                        }
                        Button(
                            onClick = {
                                activity.startActivity(AppLockManager.deviceAdminIntent(activity))
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Open Device Administrator Settings")
                        }
                        Button(
                            onClick = { ownerInstructionsVisible = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Enable anti-uninstall protection")
                        }
                        Button(
                            onClick = { recoverySettingsVisible = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Open passcode and recovery settings")
                        }
                        if (protectionEnabled) {
                            Button(
                                onClick = {
                                    activity.startActivity(
                                        Intent(activity, LockLockActivity::class.java)
                                            .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_DISABLE)
                                    )
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Disable protection")
                            }
                        } else if (hasPasscode) {
                            Button(
                                onClick = {
                                    activity.startActivity(
                                        Intent(activity, LockLockActivity::class.java)
                                            .putExtra(AppLockManager.EXTRA_MODE, "enable")
                                    )
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Enable protection")
                            }
                        }
                        Button(
                            onClick = { activity.finish() },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Done")
                        }
                    }
                }
            }

            if (statusMessage.isNotEmpty()) {
                Text(statusMessage, color = MaterialTheme.colorScheme.error)
            }
            Spacer(modifier = Modifier.height(12.dp))
        }
    }
}

private suspend fun launchableApps(activity: AppLockActivity): List<LaunchableApp> =
    withContext(Dispatchers.IO) {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val results: List<ResolveInfo> = try {
            activity.packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL)
        } catch (_: RuntimeException) {
            emptyList()
        }
        results.mapNotNull { result ->
            val info = result.activityInfo?.applicationInfo ?: return@mapNotNull null
            if (info.packageName == activity.packageName) return@mapNotNull null
            LaunchableApp(info.packageName, info.loadLabel(activity.packageManager).toString())
        }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase(Locale.ROOT) }
    }

private fun MutableList<String>.addIfMissing(value: String) {
    if (value !in this) add(value)
}
