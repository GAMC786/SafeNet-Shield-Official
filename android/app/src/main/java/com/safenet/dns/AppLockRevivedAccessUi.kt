package com.safenet.dns

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

internal object AppLockRevivedAccessUi {
    @JvmStatic
    fun render(
        activity: LockLockActivity,
        title: String,
        description: String,
        actionLabel: String,
        onVerify: (String) -> String?,
        onRecover: Runnable,
    ) {
        AppLockRevivedTheme.applySystemBars(activity, AppLockRevivedTheme.isLight(activity))
        val host = androidx.compose.ui.platform.ComposeView(activity)
        host.setContent {
            AppLockRevivedTheme.Content(light = AppLockRevivedTheme.isLight(activity)) {
                AccessScreen(
                    title = title,
                    description = description,
                    actionLabel = actionLabel,
                    onVerify = onVerify,
                    onRecover = onRecover,
                )
            }
        }
        activity.setContentView(host)
    }
}

@Composable
private fun AccessScreen(
    title: String,
    description: String,
    actionLabel: String,
    onVerify: (String) -> String?,
    onRecover: Runnable,
) {
    var passcode by rememberSaveable { mutableStateOf("") }
    var status by remember { mutableStateOf("") }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("SAFENET  /  APP LOCK", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(24.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(title, style = MaterialTheme.typography.headlineSmall)
                    Text(
                        description,
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                    )
                    OutlinedTextField(
                        value = passcode,
                        onValueChange = { passcode = it.filter(Char::isDigit).take(12) },
                        label = { Text("SafeNet passcode") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                            keyboardType = KeyboardType.NumberPassword,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (status.isNotEmpty()) {
                        Text(status, color = MaterialTheme.colorScheme.error)
                    }
                    Button(
                        onClick = {
                            status = onVerify(passcode).orEmpty()
                            if (status.isNotEmpty()) passcode = ""
                        },
                        enabled = passcode.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(actionLabel)
                    }
                    TextButton(onClick = onRecover::run, modifier = Modifier.fillMaxWidth()) {
                        Text("Forgot passcode")
                    }
                }
            }
        }
    }
}
