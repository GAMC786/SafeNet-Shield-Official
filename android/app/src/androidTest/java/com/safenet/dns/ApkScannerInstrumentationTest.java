package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.net.Uri;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import org.json.JSONObject;

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
        new ApkScanner(context).clearScanHistory();
        new ApkScanner(context).clearSignatureUpdateForTesting();
    }

    @Test
    public void bundledDatabaseIsAvailableAndOwnApkIsSafe() {
        ApkScanner scanner = new ApkScanner(context);

        assertTrue(scanner.isAvailable());
        assertEquals("2026.09.02.2", scanner.getDatabaseVersion());

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
    public void representativeFamilyFixturesAreDetected() throws Exception {
        ApkScanner scanner = new ApkScanner(context);
        String[][] fixtures = {
            {"android-banker-fixture", "SAFENET-APK-FAMILY-FIXTURE:android-banker:v1"},
            {"android-spyware-fixture", "SAFENET-APK-FAMILY-FIXTURE:android-spyware:v1"},
            {"android-ransomware-fixture", "SAFENET-APK-FAMILY-FIXTURE:android-ransomware:v1"}
        };

        for (String[] fixtureDefinition : fixtures) {
            File fixture = createFixtureWithContent(
                fixtureDefinition[0] + ".apk",
                fixtureDefinition[1]
            );
            ApkScanner.ScanResult result = scanner.scanFileForTesting(fixture);
            assertEquals(ApkScanner.VERDICT_MALICIOUS, result.verdict);
            assertEquals(fixtureDefinition[0], result.threatName);
            fixture.delete();
        }
    }

    @Test
    public void sha256FixtureIsDetectedAndNearMatchIsSafe() throws Exception {
        File source = new File(context.getApplicationInfo().sourceDir);
        String sourceDigest = sha256(source);
        String database = "{\"version\":\"hash-fixture\",\"generatedAt\":\"2026-09-03T00:00:00Z\"," +
            "\"expiresAt\":\"2027-09-03T00:00:00Z\",\"signatures\":[{" +
            "\"id\":\"hash-fixture\",\"type\":\"sha256\",\"value\":\"" + sourceDigest +
            "\",\"threatType\":\"malware\",\"severity\":\"high\"," +
            "\"description\":\"Synthetic SHA-256 regression fixture\"}]}";
        ApkScanner hashScanner = new ApkScanner(context, database);

        ApkScanner.ScanResult hashResult = hashScanner.scanFileForTesting(source);
        assertEquals(ApkScanner.VERDICT_MALICIOUS, hashResult.verdict);
        assertEquals("hash-fixture", hashResult.threatName);

        File nearMatch = createFixtureWithContent(
            "benign-lookalike.apk",
            "SAFENET-APK-FAMILY-FIXTURE:android-banker:v2"
        );
        ApkScanner.ScanResult safeResult = new ApkScanner(context).scanFileForTesting(nearMatch);
        assertEquals(ApkScanner.VERDICT_SAFE, safeResult.verdict);
        nearMatch.delete();
    }

    @Test
    public void scanHistoryAndQuarantineMetadataCanBeClearedAndDeleted() throws Exception {
        ApkScanner scanner = new ApkScanner(context);
        File fixture = createFixtureWithEicar();

        ApkScanner.ScanResult result = scanner.scanFileForTesting(fixture);
        scanner.remember(result);

        JSONArray history = scanner.getScanHistory();
        assertEquals(1, history.length());
        assertEquals(ApkScanner.VERDICT_MALICIOUS, history.getJSONObject(0).getString("verdict"));
        assertEquals(result.packageName, history.getJSONObject(0).getString("packageName"));
        assertEquals(result.sha256, history.getJSONObject(0).getString("sha256"));
        assertEquals(result.signatureVersion, history.getJSONObject(0).getString("signatureVersion"));
        assertTrue(history.getJSONObject(0).getLong("scannedAt") > 0);

        JSONArray quarantine = scanner.getQuarantineMetadata();
        assertEquals(1, quarantine.length());
        assertEquals(result.sha256, quarantine.getJSONObject(0).getString("sha256"));
        assertEquals(result.sha256 + ".apk", quarantine.getJSONObject(0).getString("fileName"));
        assertTrue(quarantine.getJSONObject(0).getLong("sizeBytes") > 0);

        scanner.clearScanHistory();
        assertEquals(0, scanner.getScanHistory().length());
        assertEquals("Quarantine remains until explicitly deleted", 1,
            scanner.getQuarantineMetadata().length());
        assertTrue(scanner.deleteQuarantinedFile(result.sha256));
        assertEquals(0, scanner.getQuarantineMetadata().length());
        assertFalse(scanner.deleteQuarantinedFile("../" + result.sha256));
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

    @Test
    public void signedUpdatesRequireAuthenticationAndExpireSafely() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        String publicKey = android.util.Base64.encodeToString(
            keyPair.getPublic().getEncoded(),
            android.util.Base64.NO_WRAP
        );
        String bundled = "{\"version\":\"base\",\"generatedAt\":\"2026-09-02T00:00:00Z\"," +
            "\"expiresAt\":\"2027-09-02T00:00:00Z\",\"signatures\":[{" +
            "\"id\":\"base\",\"type\":\"content\",\"value\":\"base-marker\"}]}";
        ApkScanner scanner = new ApkScanner(context, bundled, publicKey);

        String payload = "{\"version\":\"signed\",\"generatedAt\":\"2026-09-03T00:00:00Z\"," +
            "\"expiresAt\":\"2027-09-03T00:00:00Z\",\"signatures\":[{" +
            "\"id\":\"signed\",\"type\":\"content\",\"value\":\"signed-marker\"}]}";
        String signedUpdate = signedEnvelope(payload, keyPair);
        assertTrue(scanner.installSignedUpdate(signedUpdate));
        assertEquals("signed", scanner.getDatabaseVersion());
        assertEquals("current", scanner.getUpdateStatus());

        JSONObject tampered = new JSONObject(signedUpdate);
        tampered.put("payload", payload.replace("signed-marker", "tampered-marker"));
        assertFalse(scanner.installSignedUpdate(tampered.toString()));
        assertEquals("signed", scanner.getDatabaseVersion());
        assertEquals("rejected", scanner.getUpdateStatus());

        String expiredPayload = "{\"version\":\"expired\",\"generatedAt\":\"2026-09-04T00:00:00Z\"," +
            "\"expiresAt\":\"2020-01-01T00:00:00Z\",\"signatures\":[{" +
            "\"id\":\"expired\",\"type\":\"content\",\"value\":\"expired-marker\"}]}";
        assertFalse(scanner.installSignedUpdate(signedEnvelope(expiredPayload, keyPair)));
        assertEquals("expired", scanner.getUpdateStatus());
        assertEquals("signed", scanner.getDatabaseVersion());
    }

    private File createFixtureWithEicar() throws IOException {
        return createFixtureWithContent("eicar-fixture.apk", EICAR);
    }

    private File createFixtureWithContent(String fileName, String content) throws IOException {
        File source = new File(context.getApplicationInfo().sourceDir);
        File fixture = new File(context.getCacheDir(), fileName);
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
            output.putNextEntry(new ZipEntry("assets/safenet-regression-fixture.txt"));
            output.write(content.getBytes("UTF-8"));
            output.closeEntry();
        }
        return fixture;
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) {
            result.append(String.format("%02x", value & 0xff));
        }
        return result.toString();
    }

    private String signedEnvelope(String payload, KeyPair keyPair) throws Exception {
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(keyPair.getPrivate());
        signer.update(payload.getBytes("UTF-8"));
        JSONObject envelope = new JSONObject();
        envelope.put("algorithm", "SHA256withRSA");
        envelope.put("payload", payload);
        envelope.put(
            "signature",
            android.util.Base64.encodeToString(signer.sign(), android.util.Base64.NO_WRAP)
        );
        return envelope.toString();
    }
}