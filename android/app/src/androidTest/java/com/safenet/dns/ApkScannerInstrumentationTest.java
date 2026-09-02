package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.net.Uri;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

@RunWith(AndroidJUnit4.class)
public class ApkScannerInstrumentationTest {
    private static final String EICAR =
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();

    @After
    public void cleanQuarantine() {
        File quarantine = new File(context.getFilesDir(), "quarantine");
        File[] files = quarantine.listFiles();
        if (files != null) {
            for (File file : files) {
                file.delete();
            }
        }
        quarantine.delete();
    }

    @Test
    public void bundledDatabaseIsAvailableAndOwnApkIsSafe() {
        ApkScanner scanner = new ApkScanner(context);

        assertTrue(scanner.isAvailable());
        assertEquals("2026.09.02.1", scanner.getDatabaseVersion());

        ApkScanner.ScanResult result = scanner.scanFileForTesting(
            new File(context.getApplicationInfo().sourceDir)
        );

        assertEquals(ApkScanner.VERDICT_SAFE, result.verdict);
        assertEquals(context.getPackageName(), result.packageName);
        assertNotNull(result.sha256);
    }

    @Test
    public void eicarFixtureIsDetectedAndQuarantined() throws Exception {
        ApkScanner scanner = new ApkScanner(context);
        File fixture = createFixtureWithEicar();

        ApkScanner.ScanResult result = scanner.scanFileForTesting(fixture);
        assertEquals(ApkScanner.VERDICT_MALICIOUS, result.verdict);
        assertEquals("eicar-test-file", result.threatName);
        assertNotNull(result.packageName);

        File quarantineCopy = new File(
            new File(context.getFilesDir(), "quarantine"),
            result.sha256 + ".apk"
        );
        assertTrue("Malicious APK should be kept in private quarantine", quarantineCopy.isFile());
        fixture.delete();
    }

    @Test
    public void malformedFileIsUnsupported() throws Exception {
        File malformed = new File(context.getCacheDir(), "malformed.apk");
        try (FileOutputStream output = new FileOutputStream(malformed)) {
            output.write("not an apk".getBytes("UTF-8"));
        }

        ApkScanner.ScanResult result = new ApkScanner(context).scanFileForTesting(malformed);
        assertEquals(ApkScanner.VERDICT_UNSUPPORTED, result.verdict);
        malformed.delete();
    }

    @Test
    public void inaccessibleSelectedUriIsUnsupported() {
        ApkScanner.ScanResult result = new ApkScanner(context).scanUri(
            Uri.parse("content://safenet.permission-denied/apk"),
            "permission-denied.apk"
        );

        assertEquals(ApkScanner.VERDICT_UNSUPPORTED, result.verdict);
        assertTrue(result.details.contains("could not be read") ||
            result.details.contains("could not open"));
    }

    @Test
    public void expiredOrEmptyDatabaseNeverReportsProtection() {
        String expiredDatabase =
            "{\"version\":\"old\",\"expiresAt\":\"2020-01-01T00:00:00Z\",\"signatures\":[{\"id\":\"x\",\"type\":\"sha256\",\"value\":\"00\"}]}";
        ApkScanner expired = new ApkScanner(context, expiredDatabase);
        assertFalse(expired.isAvailable());

        ApkScanner unavailable = new ApkScanner(context, "{\"version\":\"missing\"}");
        assertFalse(unavailable.isAvailable());
        assertEquals(
            ApkScanner.VERDICT_SCANNER_UNAVAILABLE,
            unavailable.scanFileForTesting(new File(context.getApplicationInfo().sourceDir)).verdict
        );
    }

    private File createFixtureWithEicar() throws IOException {
        File source = new File(context.getApplicationInfo().sourceDir);
        File fixture = new File(context.getCacheDir(), "eicar-fixture.apk");
        try (ZipFile input = new ZipFile(source);
             ZipOutputStream output = new ZipOutputStream(new FileOutputStream(fixture))) {
            java.util.Enumeration<? extends ZipEntry> entries = input.entries();
            byte[] buffer = new byte[32 * 1024];
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory() || entry.getName().startsWith("META-INF/")) {
                    continue;
                }
                output.putNextEntry(new ZipEntry(entry.getName()));
                try (InputStream stream = input.getInputStream(entry)) {
                    int read;
                    while ((read = stream.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                    }
                }
                output.closeEntry();
            }
            output.putNextEntry(new ZipEntry("assets/eicar-test.txt"));
            output.write(EICAR.getBytes("UTF-8"));
            output.closeEntry();
        }
        return fixture;
    }
}