package com.safenet.dns

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

private val LockBackground = Color(0xFF0F172A)
private val LockSurface = Color(0xFF1E293B)
private val LockAccent = Color(0xFF38BDF8)
private val LockText = Color(0xFFF8FAFC)
private val LockMuted = Color(0xFFCBD5E1)

@Composable
internal fun AppLockRevivedLockScreen(
    appName: String,
    onVerify: (String) -> String?,
    onRecover: () -> Unit,
) {
    var passcode by rememberSaveable { mutableStateOf("") }
    var status by remember { mutableStateOf("") }

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = LockAccent,
            onPrimary = LockBackground,
            background = LockBackground,
            surface = LockSurface,
            onSurface = LockText,
            error = Color(0xFFF87171),
        )
    ) {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .background(LockBackground),
            color = LockBackground,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 28.dp, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = "SAFENET  /  APP LOCK",
                    color = LockAccent,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(32.dp))
                Surface(
                    color = LockSurface,
                    shape = MaterialTheme.shapes.extraLarge,
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "AppLock-Revived",
                            color = LockText,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "Enter your SafeNet passcode to open $appName.",
                            color = LockMuted,
                            style = MaterialTheme.typography.bodyLarge,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(24.dp))
                        OutlinedTextField(
                            value = passcode,
                            onValueChange = { value ->
                                if (value.length <= 12 && value.all { it.isDigit() }) {
                                    passcode = value
                                    status = ""
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("SafeNet passcode") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = LockText,
                                unfocusedTextColor = LockText,
                                focusedBorderColor = LockAccent,
                                unfocusedBorderColor = LockMuted,
                                focusedLabelColor = LockAccent,
                                unfocusedLabelColor = LockMuted,
                                cursorColor = LockAccent,
                            ),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.NumberPassword,
                            ),
                        )
                        if (status.isNotEmpty()) {
                            Spacer(Modifier.height(12.dp))
                            Text(
                                text = status,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodyMedium,
                                textAlign = TextAlign.Center,
                            )
                        }
                        Spacer(Modifier.height(20.dp))
                        Button(
                            modifier = Modifier.fillMaxWidth(),
                            enabled = passcode.isNotEmpty(),
                            onClick = {
                                status = onVerify(passcode).orEmpty()
                                if (status.isNotEmpty()) passcode = ""
                            },
                        ) {
                            Text("Unlock")
                        }
                        TextButton(onClick = onRecover) {
                            Text("Forgot passcode?")
                        }
                    }
                }
            }
        }
    }
}
