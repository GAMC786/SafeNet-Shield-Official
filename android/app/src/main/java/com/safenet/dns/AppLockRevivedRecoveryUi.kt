package com.safenet.dns

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

internal object AppLockRevivedRecoveryUi {
    @JvmStatic
    fun render(
        activity: LockLockActivity,
        lightTheme: Boolean,
        onReset: (String, String, String) -> String?,
        onEmailRecovery: Runnable,
        onBack: Runnable,
    ) {
        AppLockRevivedTheme.applySystemBars(activity, lightTheme)
        val host = androidx.compose.ui.platform.ComposeView(activity)
        host.setContent {
            AppLockRevivedTheme.Content(light = lightTheme) {
                RecoveryScreen(
                    question = AppLockManager.recoveryQuestion(activity),
                    onReset = onReset,
                    onEmailRecovery = onEmailRecovery,
                    onBack = onBack,
                )
            }
        }
        activity.setContentView(host)
    }
}

@Composable
private fun RecoveryScreen(
    question: String,
    onReset: (String, String, String) -> String?,
    onEmailRecovery: Runnable,
    onBack: Runnable,
) {
    var answer by rememberSaveable { mutableStateOf("") }
    var passcode by rememberSaveable { mutableStateOf("") }
    var confirmation by rememberSaveable { mutableStateOf("") }
    var status by remember { mutableStateOf("") }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("SAFENET  /  APP LOCK", style = MaterialTheme.typography.labelMedium)
            Text("Recover your passcode", style = MaterialTheme.typography.headlineMedium)
            Text(
                "Answer your recovery question and choose a new local passcode.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("Recovery question", style = MaterialTheme.typography.titleMedium)
                    Text(question.ifBlank { "No recovery question was saved for this device." })
                    OutlinedTextField(
                        value = answer,
                        onValueChange = { answer = it },
                        label = { Text("Recovery answer") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = passcode,
                        onValueChange = { passcode = it.filter(Char::isDigit).take(12) },
                        label = { Text("New passcode") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = confirmation,
                        onValueChange = { confirmation = it.filter(Char::isDigit).take(12) },
                        label = { Text("Confirm new passcode") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = { status = onReset(answer, passcode, confirmation).orEmpty() },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Reset passcode")
                    }
                }
            }
            if (status.isNotEmpty()) {
                Text(status, color = MaterialTheme.colorScheme.error)
            }
            TextButton(onClick = onEmailRecovery::run, modifier = Modifier.fillMaxWidth()) {
                Text("Email-assisted recovery")
            }
            TextButton(onClick = onBack::run, modifier = Modifier.fillMaxWidth()) {
                Text("Back to passcode")
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
