package com.safenet.dns;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

final class ApkScanner {
    static final String VERDICT_SAFE = "safe";
    static final String VERDICT_MALICIOUS = "malicious";
    static final String VERDICT_UNSUPPORTED = "unsupported";
    static final String VERDICT_SCANNER_UNAVAILABLE = "scanner_unavailable";

    private static final String SIGNATURE_ASSET = "antivirus/signatures.json";
    private static final String PREFS_NAME = "safenet_apk_scanner";
    private static final String PREF_LAST_SCAN = "last_scan";
    private static final long MAX_APK_BYTES = 256L * 1024L * 1024L;
    private static final long MAX_ENTRY_BYTES_TO_INSPECT = 8L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES_TO_INSPECT = 64L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 32 * 1024;

    private final Context context;
    private final SignatureDatabase database;
    private final String databaseError;

    ApkScanner(Context context) {
        this.context = context.getApplicationContext();
        SignatureDatabase loadedDatabase = null;
        String loadError = null;
        try {
            loadedDatabase = SignatureDatabase.load(this.context);
        } catch (IOException | JSONException | ParseException error) {
            loadError = error.getMessage() == null
                ? "The bundled signature database could not be loaded."
                : error.getMessage();
        }
        database = loadedDatabase;
        databaseError = loadError;
    }

    ApkScanner(Context context, String databaseJson) {
        this.context = context.getApplicationContext();
        SignatureDatabase loadedDatabase = null;
        String loadError = null;
        try {
            loadedDatabase = SignatureDatabase.fromJson(databaseJson);
        } catch (JSONException | ParseException error) {
            loadError = error.getMessage() == null
                ? "The signature database could not be loaded."
                : error.getMessage();
        }
        database = loadedDatabase;
        databaseError = loadError;
    }

    boolean isAvailable() {
        return database != null;
    }

    String getDatabaseVersion() {
        return database == null ? null : database.version;
    }

    String getDatabaseError() {
        return databaseError;
    }

    ScanResult scanUri(Uri uri, String displayName) {
        if (uri == null) {
            return ScanResult.unsupported(null, null, "No APK file was selected.");
        }
        if (!isAvailable()) {
            return ScanResult.scannerUnavailable(displayName, databaseError);
        }

        File temporaryFile = null;
        try {
            temporaryFile = File.createTempFile("safenet-apk-", ".apk", context.getCacheDir());
            copyUriToFile(uri, temporaryFile);
            ScanResult result = scanFile(temporaryFile, displayName, "selected");
            if (VERDICT_MALICIOUS.equals(result.verdict) && result.sha256 != null) {
                quarantine(temporaryFile, result.sha256);
            }
            return result;
        } catch (IOException error) {
            return ScanResult.unsupported(
                displayName,
                null,
                "The selected APK could not be read. Check that SafeNet has access to the file."
            );
        } finally {
            if (temporaryFile != null && temporaryFile.exists() && !temporaryFile.delete()) {
                temporaryFile.deleteOnExit();
            }
        }
    }

    List<ScanResult> scanInstalledApplications() {
        List<ScanResult> results = new ArrayList<>();
        if (!isAvailable()) {
            results.add(ScanResult.scannerUnavailable(null, databaseError));
            return results;
        }

        PackageManager packageManager = context.getPackageManager();
        List<ApplicationInfo> applications =
            packageManager.getInstalledApplications(PackageManager.GET_META_DATA);
        for (ApplicationInfo application : applications) {
            if (application.sourceDir == null || application.sourceDir.trim().isEmpty()) {
                continue;
            }
            String label;
            try {
                label = packageManager.getApplicationLabel(application).toString();
            } catch (Exception ignored) {
                label = application.packageName;
            }
            File source = new File(application.sourceDir);
            ScanResult result = scanFile(source, label, "installed");
            if (VERDICT_MALICIOUS.equals(result.verdict) && result.sha256 != null) {
                quarantine(source, result.sha256);
            }
            results.add(result);
        }
        return results;
    }

    ScanResult scanFileForTesting(File file) {
        ScanResult result = scanFile(file, file == null ? null : file.getName(), "selected");
        if (VERDICT_MALICIOUS.equals(result.verdict) && result.sha256 != null && file != null) {
            quarantine(file, result.sha256);
        }
        return result;
    }

    void remember(ScanResult result) {
        if (result == null) {
            return;
        }
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_LAST_SCAN, result.toJson().toString())
            .apply();
    }

    JSONObject getLastScan() {
        String stored = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREF_LAST_SCAN, null);
        if (stored == null) {
            return null;
        }
        try {
            return new JSONObject(stored);
        } catch (JSONException error) {
            return null;
        }
    }

    private ScanResult scanFile(File file, String displayName, String source) {
        if (!isAvailable()) {
            return ScanResult.scannerUnavailable(displayName, databaseError);
        }
        if (!file.isFile()) {
            return ScanResult.unsupported(displayName, source, "The APK file is unavailable.");
        }
        if (file.length() == 0 || file.length() > MAX_APK_BYTES) {
            return ScanResult.unsupported(
                displayName,
                source,
                "The APK must be between 1 byte and 256 MB."
            );
        }

        try {
            String sha256 = sha256(file);
            PackageInfo packageInfo = context.getPackageManager().getPackageArchiveInfo(
                file.getAbsolutePath(),
                PackageManager.GET_META_DATA
            );
            if (packageInfo == null || packageInfo.packageName == null) {
                return ScanResult.unsupported(
                    displayName,
                    source,
                    "The file is not a readable Android APK."
                );
            }

            String packageLabel = displayName;
            if (packageInfo.applicationInfo != null) {
                packageInfo.applicationInfo.sourceDir = file.getAbsolutePath();
                try {
                    packageLabel = context.getPackageManager()
                        .getApplicationLabel(packageInfo.applicationInfo)
                        .toString();
                } catch (Exception ignored) {
                    // Keep the document name if Android cannot resolve the label.
                }
            }

            ZipInspection inspection = inspectZip(file);
            if (!inspection.hasManifest || !inspection.hasDex) {
                return ScanResult.unsupported(
                    packageLabel,
                    source,
                    "The APK is missing a required Android manifest or executable code."
                ).withMetadata(packageInfo, sha256, database.version);
            }

            SignatureMatch match = database.findMatch(sha256, inspection.content);
            if (match != null) {
                return ScanResult.malicious(
                    packageLabel,
                    source,
                    packageInfo,
                    sha256,
                    database.version,
                    match
                );
            }

            return ScanResult.safe(
                packageLabel,
                source,
                packageInfo,
                sha256,
                database.version
            );
        } catch (IOException | NoSuchAlgorithmException error) {
            return ScanResult.unsupported(
                displayName,
                source,
                error.getMessage() == null ? "The APK could not be inspected." : error.getMessage()
            );
        }
    }

    private void copyUriToFile(Uri uri, File destination) throws IOException {
        InputStream input = context.getContentResolver().openInputStream(uri);
        if (input == null) {
            throw new IOException("Android could not open the selected file.");
        }
        try (InputStream source = input; FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            long copied = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                copied += read;
                if (copied > MAX_APK_BYTES) {
                    throw new IOException("The APK is larger than the 256 MB scan limit.");
                }
                output.write(buffer, 0, read);
            }
        }
    }

    private void quarantine(File source, String sha256) {
        File quarantineDirectory = new File(context.getFilesDir(), "quarantine");
        if (!quarantineDirectory.isDirectory() && !quarantineDirectory.mkdirs()) {
            return;
        }
        File destination = new File(quarantineDirectory, sha256 + ".apk");
        try (InputStream input = new FileInputStream(source);
             FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } catch (IOException ignored) {
            // A detection remains a blocked result even if private quarantine storage fails.
        }
    }

    private String sha256(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder result = new StringBuilder(digest.getDigestLength() * 2);
        for (byte value : digest.digest()) {
            result.append(String.format(Locale.US, "%02x", value & 0xff));
        }
        return result.toString();
    }

    private ZipInspection inspectZip(File file) throws IOException {
        boolean hasManifest = false;
        boolean hasDex = false;
        ByteArrayOutputStream inspectedContent = new ByteArrayOutputStream();
        long totalInspected = 0;
        try (ZipFile zip = new ZipFile(file)) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName();
                if ("AndroidManifest.xml".equals(name)) {
                    hasManifest = true;
                }
                if (name.matches("classes([2-9][0-9]*)?\\.dex")) {
                    hasDex = true;
                }

                long expectedSize = entry.getSize();
                long limit = expectedSize < 0
                    ? MAX_ENTRY_BYTES_TO_INSPECT
                    : Math.min(expectedSize, MAX_ENTRY_BYTES_TO_INSPECT);
                limit = Math.min(limit, MAX_TOTAL_BYTES_TO_INSPECT - totalInspected);
                if (limit <= 0) {
                    break;
                }
                try (InputStream input = zip.getInputStream(entry)) {
                    byte[] buffer = new byte[BUFFER_SIZE];
                    long inspected = 0;
                    int read;
                    while (inspected < limit &&
                        (read = input.read(buffer, 0, (int) Math.min(buffer.length, limit - inspected))) != -1) {
                        inspected += read;
                        inspectedContent.write(buffer, 0, read);
                    }
                    totalInspected += inspected;
                }
            }
        }
        return new ZipInspection(hasManifest, hasDex, inspectedContent.toByteArray());
    }

    static final class ScanResult {
        final String verdict;
        final String displayName;
        final String source;
        final String packageName;
        final String versionName;
        final String sha256;
        final String signatureVersion;
        final String threatType;
        final String severity;
        final String threatName;
        final String details;
        final long scannedAt;

        private ScanResult(
            String verdict,
            String displayName,
            String source,
            String packageName,
            String versionName,
            String sha256,
            String signatureVersion,
            String threatType,
            String severity,
            String threatName,
            String details
        ) {
            this.verdict = verdict;
            this.displayName = displayName;
            this.source = source;
            this.packageName = packageName;
            this.versionName = versionName;
            this.sha256 = sha256;
            this.signatureVersion = signatureVersion;
            this.threatType = threatType;
            this.severity = severity;
            this.threatName = threatName;
            this.details = details;
            this.scannedAt = System.currentTimeMillis();
        }

        static ScanResult safe(
            String displayName,
            String source,
            PackageInfo packageInfo,
            String sha256,
            String signatureVersion
        ) {
            return new ScanResult(
                VERDICT_SAFE,
                displayName,
                source,
                packageInfo.packageName,
                packageInfo.versionName,
                sha256,
                signatureVersion,
                null,
                null,
                null,
                "No matching signatures were found in the offline database."
            );
        }

        static ScanResult malicious(
            String displayName,
            String source,
            PackageInfo packageInfo,
            String sha256,
            String signatureVersion,
            SignatureMatch match
        ) {
            return new ScanResult(
                VERDICT_MALICIOUS,
                displayName,
                source,
                packageInfo.packageName,
                packageInfo.versionName,
                sha256,
                signatureVersion,
                match.threatType,
                match.severity,
                match.id,
                match.description
            );
        }

        static ScanResult unsupported(String displayName, String source, String details) {
            return new ScanResult(
                VERDICT_UNSUPPORTED,
                displayName,
                source,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                details
            );
        }

        static ScanResult scannerUnavailable(String displayName, String details) {
            return new ScanResult(
                VERDICT_SCANNER_UNAVAILABLE,
                displayName,
                "selected",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                details == null ? "The offline signature database is unavailable." : details
            );
        }

        ScanResult withMetadata(PackageInfo packageInfo, String digest, String signatures) {
            return new ScanResult(
                verdict,
                displayName,
                source,
                packageInfo.packageName,
                packageInfo.versionName,
                digest,
                signatures,
                threatType,
                severity,
                threatName,
                details
            );
        }

        JSONObject toJson() {
            JSONObject result = new JSONObject();
            try {
                result.put("verdict", verdict);
                result.put("displayName", JSONObject.wrap(displayName));
                result.put("source", JSONObject.wrap(source));
                result.put("packageName", JSONObject.wrap(packageName));
                result.put("versionName", JSONObject.wrap(versionName));
                result.put("sha256", JSONObject.wrap(sha256));
                result.put("signatureVersion", JSONObject.wrap(signatureVersion));
                result.put("threatType", JSONObject.wrap(threatType));
                result.put("severity", JSONObject.wrap(severity));
                result.put("threatName", JSONObject.wrap(threatName));
                result.put("details", JSONObject.wrap(details));
                result.put("scannedAt", scannedAt);
            } catch (JSONException ignored) {
                // All values above are JSON-compatible primitives or null.
            }
            return result;
        }
    }

    private static final class ZipInspection {
        final boolean hasManifest;
        final boolean hasDex;
        final byte[] content;

        ZipInspection(boolean hasManifest, boolean hasDex, byte[] content) {
            this.hasManifest = hasManifest;
            this.hasDex = hasDex;
            this.content = content;
        }
    }

    private static final class SignatureMatch {
        final String id;
        final String threatType;
        final String severity;
        final String description;

        SignatureMatch(String id, String threatType, String severity, String description) {
            this.id = id;
            this.threatType = threatType;
            this.severity = severity;
            this.description = description;
        }
    }

    private static final class SignatureDatabase {
        final String version;
        final List<Signature> signatures;

        private SignatureDatabase(String version, List<Signature> signatures) {
            this.version = version;
            this.signatures = signatures;
        }

        static SignatureDatabase load(Context context)
            throws IOException, JSONException, ParseException {
            String json;
            try (InputStream input = context.getAssets().open(SIGNATURE_ASSET);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                json = output.toString("UTF-8");
            }
            return fromJson(json);
        }

        static SignatureDatabase fromJson(String json)
            throws JSONException, ParseException {
            JSONObject root = new JSONObject(json);
            String version = root.optString("version", "").trim();
            String expiresAt = root.optString("expiresAt", "").trim();
            if (version.isEmpty() || expiresAt.isEmpty()) {
                throw new JSONException("The signature database has no version or expiry.");
            }
            if (parseDate(expiresAt) <= System.currentTimeMillis()) {
                throw new ParseException("The bundled signature database is expired.", 0);
            }

            JSONArray entries = root.optJSONArray("signatures");
            if (entries == null || entries.length() == 0) {
                throw new JSONException("The signature database contains no signatures.");
            }

            List<Signature> signatures = new ArrayList<>();
            for (int index = 0; index < entries.length(); index++) {
                JSONObject entry = entries.getJSONObject(index);
                String id = entry.optString("id", "").trim();
                String type = entry.optString("type", "").trim();
                String value = entry.optString("value", "");
                if (id.isEmpty() || value.isEmpty() ||
                    (!"sha256".equals(type) && !"content".equals(type) && !"content_base64".equals(type))) {
                    throw new JSONException("The signature database contains an invalid entry.");
                }
                signatures.add(new Signature(
                    id,
                    type,
                    value,
                    entry.optString("threatType", "malware"),
                    entry.optString("severity", "high"),
                    entry.optString("description", "A known threat signature matched.")
                ));
            }
            return new SignatureDatabase(version, signatures);
        }

        SignatureMatch findMatch(String sha256, byte[] inspectedContent) {
            String content = new String(inspectedContent, java.nio.charset.StandardCharsets.ISO_8859_1);
            for (Signature signature : signatures) {
                String pattern = signature.value;
                if ("content_base64".equals(signature.type)) {
                    try {
                        pattern = new String(
                            android.util.Base64.decode(signature.value, android.util.Base64.DEFAULT),
                            java.nio.charset.StandardCharsets.ISO_8859_1
                        );
                    } catch (IllegalArgumentException error) {
                        continue;
                    }
                }
                boolean matched = "sha256".equals(signature.type)
                    ? pattern.equalsIgnoreCase(sha256)
                    : content.contains(pattern);
                if (matched) {
                    return new SignatureMatch(
                        signature.id,
                        signature.threatType,
                        signature.severity,
                        signature.description
                    );
                }
            }
            return null;
        }

        private static long parseDate(String value) throws ParseException {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date date = format.parse(value);
            return date.getTime();
        }
    }

    private static final class Signature {
        final String id;
        final String type;
        final String value;
        final String threatType;
        final String severity;
        final String description;

        Signature(
            String id,
            String type,
            String value,
            String threatType,
            String severity,
            String description
        ) {
            this.id = id;
            this.type = type;
            this.value = value;
            this.threatType = threatType;
            this.severity = severity;
            this.description = description;
        }
    }
}