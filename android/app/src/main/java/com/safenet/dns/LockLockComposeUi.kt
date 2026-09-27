/*
 * Portions of this file are adapted from LockLock by nethical6:
 * https://github.com/nethical6/LockLock
 *
 * LockLock is licensed under the GNU General Public License v3.0 or later.
 * Modified for SafeNet: package identity, SafeNet AppLockManager integration,
 * SafeNet recovery entry points, and SafeNet permission lifecycle handling.
 */
package com.safenet.dns

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.UserManager
import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.graphics.drawable.toBitmap
import androidx.compose.ui.platform.ViewCompositionStrategy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class LockLockApp(
    val packageName: String,
    val name: String,
    val icon: androidx.compose.ui.graphics.ImageBitmap,
)

private data class DeviceOwnerRestrictionOption(
    val key: String,
    val title: String,
    val details: String,
    val minimumSdk: Int = Build.VERSION_CODES.N,
)

private val DEVICE_OWNER_RESTRICTIONS = listOf(
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_SAFE_BOOT,
        "Block Safe Mode",
        "Can remove an emergency troubleshooting path.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_DEBUGGING_FEATURES,
        "Block developer and USB debugging",
        "Disables Android debugging features.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_FACTORY_RESET,
        "Block factory reset in Settings",
        "Restricts the Settings reset flow; it does not replace physical recovery or device reset controls.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_OUTGOING_CALLS,
        "Block outgoing calls",
        "May affect calls and communication apps.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_SMS,
        "Block SMS",
        "May disable SafeNet messaging and other default SMS apps.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_ADD_USER,
        "Block adding Android users",
        "Prevents creating additional device users.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_REMOVE_USER,
        "Block removing Android users",
        "Prevents removing additional device users.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_MODIFY_ACCOUNTS,
        "Block account changes",
        "Prevents adding or removing accounts.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_INSTALL_APPS,
        "Block app installs",
        "Prevents installing apps from Android installation flows.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_UNINSTALL_APPS,
        "Block app removals",
        "Applies to other apps too, not just SafeNet.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_SET_WALLPAPER,
        "Block wallpaper changes",
        "Prevents changing the system wallpaper.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_USB_FILE_TRANSFER,
        "Block USB file transfer",
        "Prevents USB file-transfer access to this device.",
        Build.VERSION_CODES.LOLLIPOP,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_CONFIG_PRIVATE_DNS,
        "Block Private DNS changes",
        "May interfere with SafeNet Private DNS setup and recovery.",
        Build.VERSION_CODES.Q,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_CONFIG_VPN,
        "Block VPN changes",
        "May interfere with SafeNet VPN configuration and other VPN apps.",
        Build.VERSION_CODES.N,
    ),
    DeviceOwnerRestrictionOption(
        UserManager.DISALLOW_CONFIG_CREDENTIALS,
        "Block credential changes",
        "Can prevent changing saved credentials and certificates.",
        Build.VERSION_CODES.N,
    ),
)

private enum class LockLockDialog {
    SETTINGS,
    DEVICE_OWNER,
    ACCOUNT_RECOVERY,
    CHANGE_PASSCODE,
}

private val SafeNetBackground = Color(0xFF0F172A)
private val SafeNetSurface = Color(0xFF182135)
private val SafeNetSurfaceAlt = Color(0xFF1E293B)
private val SafeNetPrimary = Color(0xFF3B82F6)
private val SafeNetAccent = Color(0xFF38BDF8)
private val SafeNetText = Color(0xFFF8FAFC)
private val SafeNetBody = Color(0xFFCBD5E1)
private val SafeNetMuted = Color(0xFF94A3B8)
private val SafeNetBorder = Color(0xFF334155)
private val SafeNetSuccess = Color(0xFF34D399)
private val SafeNetDanger = Color(0xFFF87171)

object LockLockComposeUi {
    @JvmStatic
    fun render(activity: AppLockActivity, host: ComposeView, onSaved: Runnable) {
        host.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        host.setContent {
            LockLockTheme {
                LockLockConfigurationScreen(activity, onSaved)
            }
        }
    }
}

@Composable
private fun LockLockTheme(content: @Composable () -> Unit) {
    val colors = androidx.compose.material3.darkColorScheme(
        primary = SafeNetPrimary,
        onPrimary = SafeNetText,
        primaryContainer = Color(0xFF1E3A8A),
        onPrimaryContainer = SafeNetText,
        secondary = SafeNetAccent,
        onSecondary = SafeNetBackground,
        secondaryContainer = Color(0xFF164E63),
        onSecondaryContainer = SafeNetText,
        background = SafeNetBackground,
        onBackground = SafeNetText,
        surface = SafeNetSurface,
        onSurface = SafeNetText,
        surfaceVariant = SafeNetSurfaceAlt,
        onSurfaceVariant = SafeNetBody,
        outline = SafeNetBorder,
        outlineVariant = SafeNetBorder.copy(alpha = 0.65f),
        error = SafeNetDanger,
        onError = SafeNetBackground,
    )
    MaterialTheme(
        colorScheme = colors,
        shapes = androidx.compose.material3.Shapes(
            small = RoundedCornerShape(8.dp),
            medium = RoundedCornerShape(12.dp),
            large = RoundedCornerShape(18.dp),
        ),
        typography = MaterialTheme.typography.copy(
            headlineSmall = MaterialTheme.typography.headlineSmall.copy(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
            ),
            titleLarge = MaterialTheme.typography.titleLarge.copy(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
            ),
            titleMedium = MaterialTheme.typography.titleMedium.copy(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
            ),
            labelLarge = MaterialTheme.typography.labelLarge.copy(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
            ),
        ),
        content = content,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LockLockConfigurationScreen(activity: AppLockActivity, onSaved: Runnable) {
    val context = LocalContext.current
    var apps by remember { mutableStateOf(emptyList<LockLockApp>()) }
    val selectedApps = remember {
        mutableStateListOf<String>().also {
            it.addAll(AppLockManager.getLockedPackages(context))
        }
    }
    var searchQuery by remember { mutableStateOf("") }
    var dialog by remember { mutableStateOf<LockLockDialog?>(null) }
    var pin by remember { mutableStateOf("") }
    var pinConfirmation by remember { mutableStateOf("") }
    var question by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf("") }
    var configured by remember { mutableStateOf(AppLockManager.hasPin(context)) }
    var protectionEnabled by remember { mutableStateOf(AppLockManager.isEnabled(context)) }
    var antiUninstall by remember {
        mutableStateOf(AppLockManager.isAntiUninstallEnabled(context))
    }
    var accessibilityEnabled by remember {
        mutableStateOf(AppLockManager.isAccessibilityServiceEnabled(context))
    }
    var overlayEnabled by remember {
        mutableStateOf(AppLockManager.isOverlayPermissionEnabled(context))
    }
    var deviceOwnerEnabled by remember {
        mutableStateOf(AppLockManager.isDeviceOwnerEnabled(context))
    }
    var packagePolicyRevision by remember { mutableStateOf(0) }
    val protectionActive = protectionEnabled
        && configured
        && accessibilityEnabled
        && overlayEnabled

    fun refreshState() {
        configured = AppLockManager.hasPin(context)
        protectionEnabled = AppLockManager.isEnabled(context)
        antiUninstall = AppLockManager.isAntiUninstallEnabled(context)
        accessibilityEnabled = AppLockManager.isAccessibilityServiceEnabled(context)
        overlayEnabled = AppLockManager.isOverlayPermissionEnabled(context)
        deviceOwnerEnabled = AppLockManager.isDeviceOwnerEnabled(context)
    }

    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.Default) {
            queryLaunchableApps(context)
        }
    }

    LaunchedEffect(Unit) {
        refreshState()
    }

    val filteredApps = remember(apps, searchQuery) {
        val query = searchQuery.trim()
        if (query.isEmpty()) {
            apps
        } else {
            apps.filter {
                it.name.contains(query, ignoreCase = true) ||
                    it.packageName.contains(query, ignoreCase = true)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "SAFENET  /  APP LOCK",
                            style = MaterialTheme.typography.labelSmall,
                            color = SafeNetAccent,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                        )
                        Text("Select Apps", fontWeight = FontWeight.Bold)
                        Text(
                            if (protectionActive) {
                                "Protection is active"
                            } else if (protectionEnabled) {
                                "Not protecting apps — check permissions"
                            } else {
                                "Protection is ready"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (protectionActive) {
                                SafeNetSuccess
                            } else if (protectionEnabled) {
                                SafeNetDanger
                            } else {
                                SafeNetMuted
                            },
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { dialog = LockLockDialog.SETTINGS }) {
                        Icon(Icons.Default.Settings, contentDescription = "Open Settings")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SafeNetBackground.copy(alpha = 0.96f),
                    scrolledContainerColor = SafeNetSurface,
                ),
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color(0xFF172554),
                            SafeNetBackground,
                            Color(0xFF020617),
                        )
                    )
                )
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
        ) {
            if (!configured) {
                SetupCard(
                    pin = pin,
                    confirmation = pinConfirmation,
                    question = question,
                    answer = answer,
                    errorMessage = errorMessage,
                    onPinChange = { pin = it },
                    onConfirmationChange = { pinConfirmation = it },
                    onQuestionChange = { question = it },
                    onAnswerChange = { answer = it },
                    onSave = {
                        try {
                            AppLockManager.configure(context, pin, question, answer)
                            AppLockManager.setLockedPackages(context, selectedApps.toSet())
                            AppLockManager.setEnabled(context, true)
                            AppLockManager.clearSession()
                            errorMessage = ""
                            refreshState()
                            onSaved.run()
                        } catch (error: IllegalArgumentException) {
                            errorMessage = error.message ?: "Could not save App Lock."
                        }
                    },
                )
            } else {
                PermissionSummary(
                    accessibilityEnabled = accessibilityEnabled,
                    overlayEnabled = overlayEnabled,
                    antiUninstall = antiUninstall,
                    deviceOwnerEnabled = deviceOwnerEnabled,
                    onAccessibility = {
                        context.startActivity(AppLockManager.accessibilitySettingsIntent())
                    },
                    onOverlay = {
                        context.startActivity(AppLockManager.overlayPermissionIntent(context))
                    },
                    onDeviceOwner = {
                        dialog = LockLockDialog.DEVICE_OWNER
                    },
                    onAntiUninstallChange = { checked ->
                        if (checked && !deviceOwnerEnabled) {
                            dialog = LockLockDialog.DEVICE_OWNER
                        } else {
                            try {
                                AppLockManager.setAntiUninstallEnabled(context, checked)
                                antiUninstall = checked
                                refreshState()
                            } catch (error: RuntimeException) {
                                Toast.makeText(
                                    context,
                                    error.message ?: "Could not change anti-uninstall protection.",
                                    Toast.LENGTH_LONG,
                                ).show()
                            }
                        }
                    },
                    onLegacyRecovery = {
                        dialog = LockLockDialog.SETTINGS
                    },
                )
            }

            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                label = { Text("Search apps") },
                placeholder = { Text("Type app name...") },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = "Search")
                },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear search")
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 8.dp),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = SafeNetAccent,
                    unfocusedBorderColor = SafeNetBorder,
                    focusedLabelColor = SafeNetAccent,
                    unfocusedLabelColor = SafeNetMuted,
                    cursorColor = SafeNetAccent,
                    focusedLeadingIconColor = SafeNetAccent,
                    unfocusedLeadingIconColor = SafeNetMuted,
                    focusedTrailingIconColor = SafeNetAccent,
                    unfocusedTrailingIconColor = SafeNetMuted,
                ),
            )

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(top = 8.dp, bottom = 20.dp),
            ) {
                items(filteredApps.sortedBy { it.name }, key = { it.packageName }) { app ->
                    val isSuspended = remember(app.packageName, packagePolicyRevision) {
                        AppLockManager.isPackageSuspended(context, app.packageName)
                    }
                    val isHidden = remember(app.packageName, packagePolicyRevision) {
                        AppLockManager.isPackageHidden(context, app.packageName)
                    }
                    val suspendedManaged = remember(app.packageName, packagePolicyRevision) {
                        AppLockManager.isPackageSuspendedManagedBySafeNet(
                            context,
                            app.packageName,
                        )
                    }
                    val hiddenManaged = remember(app.packageName, packagePolicyRevision) {
                        AppLockManager.isPackageHiddenManagedBySafeNet(
                            context,
                            app.packageName,
                        )
                    }
                    LockLockAppSelectionItem(
                        app = app,
                        selected = selectedApps.contains(app.packageName),
                        deviceOwnerEnabled = deviceOwnerEnabled,
                        canManagePolicy = AppLockManager.canManagePackagePolicy(
                            context,
                            app.packageName,
                        ),
                        suspended = isSuspended,
                        hidden = isHidden,
                        suspendedManaged = suspendedManaged,
                        hiddenManaged = hiddenManaged,
                        onToggle = { checked ->
                            if (checked) {
                                if (!selectedApps.contains(app.packageName)) {
                                    selectedApps.add(app.packageName)
                                }
                            } else {
                                selectedApps.remove(app.packageName)
                            }
                            AppLockManager.setLockedPackages(context, selectedApps.toSet())
                        },
                        onSuspendedChange = { suspended ->
                            if (!suspended && isSuspended && !suspendedManaged) {
                                Toast.makeText(
                                    context,
                                    "SafeNet will not restore an app state it did not apply.",
                                    Toast.LENGTH_LONG,
                                ).show()
                                return@LockLockAppSelectionItem
                            }
                            try {
                                AppLockManager.setPackageSuspendedBySafeNet(
                                    context,
                                    app.packageName,
                                    suspended,
                                )
                                packagePolicyRevision++
                            } catch (error: RuntimeException) {
                                Toast.makeText(
                                    context,
                                    error.message ?: "Could not change app suspension.",
                                    Toast.LENGTH_LONG,
                                ).show()
                            }
                        },
                        onHiddenChange = { hidden ->
                            if (!hidden && isHidden && !hiddenManaged) {
                                Toast.makeText(
                                    context,
                                    "SafeNet will not restore an app state it did not apply.",
                                    Toast.LENGTH_LONG,
                                ).show()
                                return@LockLockAppSelectionItem
                            }
                            try {
                                AppLockManager.setPackageHiddenBySafeNet(
                                    context,
                                    app.packageName,
                                    hidden,
                                )
                                packagePolicyRevision++
                            } catch (error: RuntimeException) {
                                Toast.makeText(
                                    context,
                                    error.message ?: "Could not change app visibility.",
                                    Toast.LENGTH_LONG,
                                ).show()
                            }
                        },
                    )
                }
            }
            if (configured) {
                Button(
                    onClick = { },
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, SafeNetBorder, RoundedCornerShape(12.dp)),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = SafeNetAccent,
                    ),
                ) {
                    Text("Add protected apps")
                }
                Button(
                    onClick = {
                        AppLockManager.setLockedPackages(context, selectedApps.toSet())
                        Toast.makeText(context, "Protected apps saved.", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp, bottom = 12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = SafeNetPrimary,
                        contentColor = SafeNetText,
                    ),
                ) {
                    Text("Protect selected apps")
                }
            }
        }
    }

    when (dialog) {
        LockLockDialog.SETTINGS -> {
            LockLockSettingsDialog(
                antiUninstall = antiUninstall,
                deviceOwnerEnabled = deviceOwnerEnabled,
                onDismiss = { dialog = null },
                onOpenDeviceOwner = { dialog = LockLockDialog.DEVICE_OWNER },
                onAntiUninstallChange = { checked ->
                    if (checked && !deviceOwnerEnabled) {
                        dialog = LockLockDialog.DEVICE_OWNER
                    } else {
                        try {
                            AppLockManager.setAntiUninstallEnabled(context, checked)
                            antiUninstall = checked
                            refreshState()
                        } catch (error: RuntimeException) {
                            Toast.makeText(
                                context,
                                error.message ?: "Could not change anti-uninstall protection.",
                                Toast.LENGTH_LONG,
                            ).show()
                        }
                    }
                },
                onChangePasscode = {
                    dialog = LockLockDialog.CHANGE_PASSCODE
                },
                onRecovery = { dialog = LockLockDialog.ACCOUNT_RECOVERY },
                onProtectionChange = { enabled ->
                    if (enabled && configured) {
                        AppLockManager.setEnabled(context, true)
                        protectionEnabled = true
                    } else if (!enabled && protectionEnabled) {
                        context.startActivity(
                            Intent(context, AppLockActivity::class.java)
                                .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_DISABLE)
                        )
                    }
                },
            )
        }
        LockLockDialog.DEVICE_OWNER -> {
            DeviceOwnerSettingsDialog(
                context = context,
                deviceOwnerEnabled = deviceOwnerEnabled,
                onDismiss = {
                    dialog = LockLockDialog.SETTINGS
                    refreshState()
                },
                onPoliciesChanged = {
                    packagePolicyRevision++
                    refreshState()
                },
            )
        }
        LockLockDialog.CHANGE_PASSCODE -> {
            ChangePasscodeDialog(
                onDismiss = { dialog = LockLockDialog.SETTINGS },
                onSave = { newPin, confirmation ->
                    if (newPin != confirmation) {
                        Toast.makeText(context, "Passcodes do not match.", Toast.LENGTH_SHORT).show()
                    } else {
                        try {
                            AppLockManager.resetPin(context, newPin)
                            Toast.makeText(context, "Passcode updated.", Toast.LENGTH_SHORT).show()
                            dialog = LockLockDialog.SETTINGS
                        } catch (error: IllegalArgumentException) {
                            Toast.makeText(
                                context,
                                error.message ?: "Could not update passcode.",
                                Toast.LENGTH_LONG,
                            ).show()
                        }
                    }
                },
            )
        }
        LockLockDialog.ACCOUNT_RECOVERY -> {
            LockLockRecoveryDialog(
                onDismiss = { dialog = LockLockDialog.SETTINGS },
                onProvider = { provider -> activity.openHostedSignInFromCompose(provider) },
                onForgotPasscode = {
                    dialog = null
                    context.startActivity(
                        Intent(context, LockLockActivity::class.java)
                            .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_UNLOCK)
                    )
                },
            )
        }
        null -> Unit
    }
}

@Composable
private fun SetupCard(
    pin: String,
    confirmation: String,
    question: String,
    answer: String,
    errorMessage: String,
    onPinChange: (String) -> Unit,
    onConfirmationChange: (String) -> Unit,
    onQuestionChange: (String) -> Unit,
    onAnswerChange: (String) -> Unit,
    onSave: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        colors = CardDefaults.cardColors(
            containerColor = SafeNetSurface.copy(alpha = 0.96f),
        ),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, SafeNetAccent.copy(alpha = 0.45f)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Icon(
                Icons.Default.Build,
                contentDescription = null,
                tint = SafeNetAccent,
                modifier = Modifier.size(32.dp),
            )
            Text(
                "SECURE LOCAL CONTROL",
                style = MaterialTheme.typography.labelSmall,
                color = SafeNetAccent,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                "Set up App Lock",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Create a local passcode before selecting the apps you want to protect.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            )
            OutlinedTextField(
                value = pin,
                onValueChange = { if (it.length <= 12 && it.all(Char::isDigit)) onPinChange(it) },
                label = { Text("Passcode") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = safeNetFieldColors(),
            )
            OutlinedTextField(
                value = confirmation,
                onValueChange = { if (it.length <= 12 && it.all(Char::isDigit)) onConfirmationChange(it) },
                label = { Text("Confirm passcode") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                singleLine = true,
                colors = safeNetFieldColors(),
            )
            OutlinedTextField(
                value = question,
                onValueChange = onQuestionChange,
                label = { Text("Recovery question") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                singleLine = true,
                colors = safeNetFieldColors(),
            )
            OutlinedTextField(
                value = answer,
                onValueChange = onAnswerChange,
                label = { Text("Recovery answer") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                singleLine = true,
                colors = safeNetFieldColors(),
            )
            if (errorMessage.isNotEmpty()) {
                Text(
                    errorMessage,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Button(
                onClick = onSave,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = SafeNetPrimary,
                    contentColor = SafeNetText,
                ),
            ) {
                Text("Set passcode and enable AppLock")
            }
        }
    }
}

@Composable
private fun PermissionSummary(
    accessibilityEnabled: Boolean,
    overlayEnabled: Boolean,
    antiUninstall: Boolean,
    deviceOwnerEnabled: Boolean,
    onAccessibility: () -> Unit,
    onOverlay: () -> Unit,
    onDeviceOwner: () -> Unit,
    onAntiUninstallChange: (Boolean) -> Unit,
    onLegacyRecovery: () -> Unit,
) {
    val permissions = listOf(
        Triple("Open Accessibility Settings", accessibilityEnabled, onAccessibility),
        Triple("Allow overlay", overlayEnabled, onOverlay),
        Triple(
            if (deviceOwnerEnabled) "Device Owner is active" else "Provision SafeNet as Device Owner",
            deviceOwnerEnabled,
            onDeviceOwner,
        ),
    )
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = SafeNetSurface.copy(alpha = 0.96f)),
        border = BorderStroke(1.dp, SafeNetBorder),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                "ANDROID PERMISSION GATE",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = SafeNetAccent,
            )
            Text(
                "Protection needs these Android handoffs before monitored app launches can be secured.",
                style = MaterialTheme.typography.bodySmall,
                color = SafeNetMuted,
                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
            )
            permissions.forEach { (title, granted, action) ->
                PermissionRow(title, granted, action)
            }
            TextButton(
                onClick = { onAntiUninstallChange(!antiUninstall) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (antiUninstall) "Disable anti-uninstall protection" else "Enable anti-uninstall protection")
            }
            TextButton(
                onClick = onLegacyRecovery,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Open passcode and recovery settings")
            }
        }
    }
}

@Composable
private fun PermissionRow(title: String, granted: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (granted) Icons.Default.Lock else Icons.Default.Person,
            contentDescription = null,
            tint = if (granted) SafeNetSuccess else SafeNetDanger,
            modifier = Modifier.size(24.dp),
        )
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            Text(
                if (granted) "Ready" else "Tap to open Android settings",
                style = MaterialTheme.typography.bodySmall,
                color = if (granted) SafeNetSuccess else SafeNetMuted,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LockLockAppSelectionItem(
    app: LockLockApp,
    selected: Boolean,
    deviceOwnerEnabled: Boolean,
    canManagePolicy: Boolean,
    suspended: Boolean,
    hidden: Boolean,
    suspendedManaged: Boolean,
    hiddenManaged: Boolean,
    onToggle: (Boolean) -> Unit,
    onSuspendedChange: (Boolean) -> Unit,
    onHiddenChange: (Boolean) -> Unit,
) {
    val colorScheme = MaterialTheme.colorScheme
    val scale by animateFloatAsState(
        targetValue = if (selected) 1.02f else 1f,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = 700f),
        label = "scale",
    )
    val containerColor by animateColorAsState(
        targetValue = if (selected) {
            colorScheme.primaryContainer
        } else {
            colorScheme.surfaceVariant.copy(alpha = 0.9f)
        },
        animationSpec = tween(300),
        label = "containerColor",
    )
    val contentColor by animateColorAsState(
        targetValue = if (selected) {
            colorScheme.onPrimaryContainer
        } else {
            colorScheme.onSurface.copy(alpha = 0.87f)
        },
        animationSpec = tween(300),
        label = "contentColor",
    )
    Card(
        onClick = { onToggle(!selected) },
        modifier = Modifier
            .fillMaxWidth()
                .scale(scale)
                .semantics {
                    contentDescription = "Protect ${app.name}"
                },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        border = BorderStroke(
            1.dp,
            if (selected) SafeNetAccent.copy(alpha = 0.72f) else SafeNetBorder,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (selected) 6.dp else 2.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .background(
                            colorScheme.primary.copy(alpha = if (selected) 0.2f else 0.08f),
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        bitmap = app.icon,
                        contentDescription = app.name,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 16.dp),
                ) {
                    Text(
                        app.name,
                        color = contentColor,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        app.packageName,
                        color = contentColor.copy(alpha = 0.6f),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                LockLockSwitch(selected, onToggle)
            }
            if (deviceOwnerEnabled) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, bottom = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "DEVICE OWNER ACTIONS",
                        color = SafeNetMuted,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                    )
                    if (canManagePolicy) {
                        if ((suspended && !suspendedManaged) || (hidden && !hiddenManaged)) {
                            Text(
                                "An app state SafeNet did not apply cannot be cleared here.",
                                color = SafeNetMuted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Suspend app", modifier = Modifier.weight(1f))
                            LockLockSwitch(suspended, onSuspendedChange)
                            Spacer(Modifier.width(16.dp))
                            Text("Hide app", modifier = Modifier.weight(1f))
                            LockLockSwitch(hidden, onHiddenChange)
                        }
                    } else {
                        Text(
                            "SafeNet and Android system apps cannot be suspended or hidden.",
                            color = SafeNetMuted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LockLockSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val offset by animateFloatAsState(
        if (checked) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.8f, stiffness = 900f),
        label = "thumbOffset",
    )
    Box(
        modifier = Modifier
            .width(52.dp)
            .height(32.dp)
            .background(
                if (checked) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                RoundedCornerShape(16.dp),
            )
            .border(
                1.dp,
                if (checked) SafeNetAccent else SafeNetBorder,
                RoundedCornerShape(16.dp),
            )
            .clickable { onCheckedChange(!checked) }
            .padding(4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .offset(x = 20.dp * offset)
                .background(MaterialTheme.colorScheme.background, CircleShape),
        )
    }
}

@Composable
private fun LockLockSettingsDialog(
    antiUninstall: Boolean,
    deviceOwnerEnabled: Boolean,
    onDismiss: () -> Unit,
    onOpenDeviceOwner: () -> Unit,
    onAntiUninstallChange: (Boolean) -> Unit,
    onChangePasscode: () -> Unit,
    onRecovery: () -> Unit,
    onProtectionChange: (Boolean) -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth(0.9f)
                .padding(16.dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = SafeNetSurface),
            border = BorderStroke(1.dp, SafeNetAccent.copy(alpha = 0.55f)),
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Settings",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }
                Text(
                    "SECURITY CONTROL",
                    color = SafeNetAccent,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
                )
                SettingButton(
                    "Device Owner and system controls",
                    Icons.Default.Build,
                    onOpenDeviceOwner,
                )
                SettingAction(
                    title = "Anti Uninstall",
                    subtitle = if (deviceOwnerEnabled) {
                        "SafeNet is Device Owner"
                    } else {
                        "Requires SafeNet Device Owner provisioning"
                    },
                    icon = Icons.Default.Lock,
                    checked = antiUninstall,
                    onClick = { onAntiUninstallChange(!antiUninstall) },
                )
                SettingButton("Change Passcode", Icons.Default.Lock, onChangePasscode)
                SettingButton("Forgot Passcode", Icons.Default.Person, onRecovery)
                TextButton(
                    onClick = { onProtectionChange(true); onDismiss() },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Keep App Lock enabled")
                }
                TextButton(
                    onClick = { onProtectionChange(false); onDismiss() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) {
                    Text("Disable App Lock")
                }
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Done")
                }
            }
        }
    }
}

@Composable
private fun DeviceOwnerSettingsDialog(
    context: Context,
    deviceOwnerEnabled: Boolean,
    onDismiss: () -> Unit,
    onPoliciesChanged: () -> Unit,
) {
    var refreshKey by remember { mutableStateOf(0) }
    var confirmRemoval by remember { mutableStateOf(false) }
    val command = remember(context) {
        AppLockManager.deviceOwnerProvisioningCommand(context)
    }

    fun showPolicyError(error: RuntimeException) {
        Toast.makeText(
            context,
            error.message ?: "Android could not update this Device Owner policy.",
            Toast.LENGTH_LONG,
        ).show()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .heightIn(max = 760.dp)
                .padding(8.dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = SafeNetSurface),
            border = BorderStroke(1.dp, SafeNetAccent.copy(alpha = 0.55f)),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Device Owner",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "ANDROID SYSTEM CONTROLS",
                            color = SafeNetAccent,
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close Device Owner settings")
                    }
                }

                if (deviceOwnerEnabled) {
                    Text(
                        "SafeNet is the Device Owner. System restrictions and app suspension are off unless you enable them below or on an app.",
                        color = SafeNetBody,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp, bottom = 10.dp),
                    )
                    SettingButton(
                        "Restore apps SafeNet suspended or hid",
                        Icons.Default.Clear,
                    ) {
                        try {
                            AppLockManager.restoreManagedPackagePolicies(context)
                            refreshKey++
                            onPoliciesChanged()
                            Toast.makeText(
                                context,
                                "SafeNet-managed app changes were restored.",
                                Toast.LENGTH_SHORT,
                            ).show()
                        } catch (error: RuntimeException) {
                            showPolicyError(error)
                        }
                    }
                    Text(
                        "SYSTEM RESTRICTIONS",
                        color = SafeNetAccent,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                    )
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 390.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(DEVICE_OWNER_RESTRICTIONS, key = { it.key }) { option ->
                            val supported = Build.VERSION.SDK_INT >= option.minimumSdk
                            val enabled = remember(refreshKey, option.key) {
                                AppLockManager.isUserRestrictionEnabled(context, option.key)
                            }
                            val owned = remember(refreshKey, option.key) {
                                AppLockManager.isUserRestrictionManagedBySafeNet(
                                    context,
                                    option.key,
                                )
                            }
                            if (supported) {
                                SettingAction(
                                    title = option.title,
                                    subtitle = if (enabled && !owned) {
                                        "Already active; SafeNet will not clear a restriction it did not apply."
                                    } else {
                                        option.details
                                    },
                                    icon = Icons.Default.Build,
                                    checked = enabled,
                                    onClick = {
                                        try {
                                            AppLockManager.setManagedUserRestriction(
                                                context,
                                                option.key,
                                                !enabled,
                                            )
                                            refreshKey++
                                            onPoliciesChanged()
                                        } catch (error: RuntimeException) {
                                            showPolicyError(error)
                                        }
                                    },
                                )
                            } else {
                                Text(
                                    "${option.title}: unavailable on this Android version.",
                                    color = SafeNetMuted,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(8.dp),
                                )
                            }
                        }
                    }
                    TextButton(
                        onClick = { confirmRemoval = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                    ) {
                        Text("Restore SafeNet policies and remove Device Owner")
                    }
                } else {
                    Text(
                        "Device Owner cannot be enabled from an app screen. Android requires an eligible, unmanaged device and external provisioning. This may require a factory reset and can make SafeNet difficult to remove if recovery is unavailable.",
                        color = SafeNetBody,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp, bottom = 12.dp),
                    )
                    SettingButton("Refresh Device Owner status", Icons.Default.Refresh) {
                        onPoliciesChanged()
                    }
                    Text(
                        "Run this command from a computer with ADB after installing SafeNet:",
                        color = SafeNetText,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        command,
                        color = SafeNetAccent,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 10.dp)
                            .background(SafeNetBackground, RoundedCornerShape(10.dp))
                            .padding(12.dp),
                    )
                    SettingButton("Copy ADB command", Icons.Default.Build) {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE)
                                as? ClipboardManager
                        if (clipboard == null) {
                            Toast.makeText(
                                context,
                                "Clipboard is unavailable.",
                                Toast.LENGTH_LONG,
                            ).show()
                        } else {
                            clipboard.setPrimaryClip(
                                ClipData.newPlainText("SafeNet Device Owner command", command)
                            )
                            Toast.makeText(
                                context,
                                "ADB command copied.",
                                Toast.LENGTH_SHORT,
                            ).show()
                        }
                    }
                    Text(
                        "The exact enrollment requirements vary by Android version and device. Do not enable restrictions until you have tested the authenticated removal flow and kept a working recovery path.",
                        color = SafeNetMuted,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }

                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Done")
                }
            }
        }
    }

    if (confirmRemoval) {
        AlertDialog(
            onDismissRequest = { confirmRemoval = false },
            title = { Text("Remove SafeNet Device Owner?") },
            text = {
                Text(
                    "SafeNet will first restore apps and restrictions it applied, then remove its Device Owner status. Existing Android restrictions that SafeNet did not apply will be left unchanged."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        try {
                            AppLockManager.removeDeviceOwner(context)
                            confirmRemoval = false
                            onPoliciesChanged()
                            Toast.makeText(
                                context,
                                "SafeNet Device Owner was removed.",
                                Toast.LENGTH_LONG,
                            ).show()
                            onDismiss()
                        } catch (error: RuntimeException) {
                            showPolicyError(error)
                        }
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) {
                    Text("Restore and remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRemoval = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingAction(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    checked: Boolean,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (checked) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            },
        ),
        shape = RoundedCornerShape(12.dp),
            border = BorderStroke(
                1.dp,
                if (checked) SafeNetAccent.copy(alpha = 0.55f) else SafeNetBorder,
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = title)
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp),
            ) {
                Text(title, fontWeight = FontWeight.Medium)
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            LockLockSwitch(checked) { newChecked ->
                if (newChecked != checked) onClick()
            }
        }
    }
}

@Composable
private fun SettingButton(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    TextButton(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
    ) {
        Icon(icon, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(title)
    }
}

@Composable
private fun ChangePasscodeDialog(
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var pin by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Change Passcode") },
        text = {
            Column {
                OutlinedTextField(
                    value = pin,
                    onValueChange = { if (it.length <= 12 && it.all(Char::isDigit)) pin = it },
                    label = { Text("New passcode") },
                    singleLine = true,
                    colors = safeNetFieldColors(),
                )
                OutlinedTextField(
                    value = confirmation,
                    onValueChange = {
                        if (it.length <= 12 && it.all(Char::isDigit)) confirmation = it
                    },
                    label = { Text("Confirm passcode") },
                    singleLine = true,
                    modifier = Modifier.padding(top = 8.dp),
                    colors = safeNetFieldColors(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(pin, confirmation) }) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
private fun LockLockRecoveryDialog(
    onDismiss: () -> Unit,
    onProvider: (String) -> Unit,
    onForgotPasscode: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("SafeNet recovery") },
        text = {
            Column {
                Text(
                    "Use SafeNet's hosted sign-in to recover the local passcode. " +
                        "No provider password is entered inside the Android app.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                listOf("Google", "Microsoft", "Yahoo", "Apple").forEach { provider ->
                    TextButton(
                        onClick = { onProvider(provider) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Person, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Continue with $provider")
                    }
                }
                TextButton(
                    onClick = onForgotPasscode,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.Lock, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Use local recovery question or email code")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Done")
            }
        },
    )
}

@Composable
private fun safeNetFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = SafeNetAccent,
    unfocusedBorderColor = SafeNetBorder,
    focusedLabelColor = SafeNetAccent,
    unfocusedLabelColor = SafeNetMuted,
    cursorColor = SafeNetAccent,
    focusedTextColor = SafeNetText,
    unfocusedTextColor = SafeNetText,
    focusedPlaceholderColor = SafeNetMuted,
    unfocusedPlaceholderColor = SafeNetMuted,
)

private fun queryLaunchableApps(context: Context): List<LockLockApp> {
    val launcher = Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
    }
    val seen = mutableSetOf<String>()
    val result = mutableListOf<LockLockApp>()
    val activities: List<ResolveInfo> = try {
        context.packageManager.queryIntentActivities(launcher, 0)
    } catch (_: RuntimeException) {
        emptyList()
    }
    activities.forEach { resolveInfo ->
        val info: ApplicationInfo = resolveInfo.activityInfo?.applicationInfo ?: return@forEach
        if (info.packageName == context.packageName || !seen.add(info.packageName)) {
            return@forEach
        }
        val icon: Drawable = info.loadIcon(context.packageManager)
        result += LockLockApp(
            packageName = info.packageName,
            name = info.loadLabel(context.packageManager).toString(),
            icon = icon.toBitmap(64, 64).asImageBitmap(),
        )
    }
    return result
}