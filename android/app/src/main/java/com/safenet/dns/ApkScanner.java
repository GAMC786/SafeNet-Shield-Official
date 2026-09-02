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
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
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
    private static final String PREF_SCAN_HISTORY = "scan_history";
    private static final String PREF_SIGNED_UPDATE = "signed_signature_update";
    private static final String PREF_UPDATE_STATUS = "signature_update_status";
    private static final String PREF_UPDATE_MESSAGE = "signature_update_message";
    private static final String PREF_LAST_UPDATE_AT = "signature_last_update_at";
    private static final int MAX_SCAN_HISTORY = 100;
    private static final long MAX_APK_BYTES = 256L * 1024L * 1024L;
    private static final long MAX_ENTRY_BYTES_TO_INSPECT = 8L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES_TO_INSPECT = 64L * 1024L * 1024L;
    private static final int MAX_SIGNED_UPDATE_BYTES = 4 * 1024 * 1024;
    private static final int BUFFER_SIZE = 32 * 1024;
    private static final String TRUSTED_UPDATE_PUBLIC_KEY =
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsAwWgg4tziUr0PIWHLxBRl/dbG1fhR1DEKOdqEBlrkLyEjIds17X62uyu4DhmRF9BFPqEe41uoFB0UeJLTHSbZSFXFFgKMuwMPw+4hz3g3VCeLiFAQUPBvsL8m+yLWMzgSLTUnEC+XuG/WlSqXUt0CZU8HSFobl3L8fSJ7UU3om749/5x/L6eaTPTICjCdYQ6kUuHmpISIlPxqz3VXBioOL7hIWnlazgNnvT5XifPNAmGkP5xkVOXxbSG+D6hfLiWWc1naZuCyAtb4xBqdp4nTf1FqBzj2jtW+Mf0GStpmeDLaO4brKQb4tDTPP4UflABS886hy2JK1HC/PsQ8FvlQIDAQAB";

    private final Context context;
    private final String trustedUpdatePublicKey;
    private volatile SignatureDatabase database;
    private volatile String databaseError;
    private volatile String updateStatus = "bundled";
    private volatile String updateMessage = "Using the bundled signature catalog.";

    ApkScanner(Context context) {
        this.context = context.getApplicationContext();
        this.trustedUpdatePublicKey = TRUSTED_UPDATE_PUBLIC_KEY;
        loadActiveDatabase();
    }

    ApkScanner(Context context, String databaseJson) {
        this(context, databaseJson, null);
    }

    ApkScanner(Context context, String databaseJson, String updatePublicKey) {
        this.context = context.getApplicationContext();
        this.trustedUpdatePublicKey = updatePublicKey == null
            ? TRUSTED_UPDATE_PUBLIC_KEY
            : updatePublicKey;
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
        updateStatus = "test";
        updateMessage = "Using an explicitly supplied signature catalog.";
    }

    private void loadActiveDatabase() {
        SignatureDatabase bundled = null;
        String loadError = null;
        android.content.SharedPreferences preferences =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            bundled = SignatureDatabase.load(this.context);
        } catch (IOException | JSONException | ParseException error) {
            loadError = error.getMessage() == null
                ? "The bundled signature database could not be loaded."
                : error.getMessage();
        }

        database = bundled;
        databaseError = loadError;

        String storedUpdate = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREF_SIGNED_UPDATE, null);
        if (storedUpdate == null) {
            String previousStatus = preferences.getString(PREF_UPDATE_STATUS, null);
            String previousMessage = preferences.getString(PREF_UPDATE_MESSAGE, null);
            updateStatus = bundled == null
                ? "unavailable"
                : (previousStatus == null ? "bundled" : previousStatus);
            updateMessage = bundled == null
                ? "No valid signature catalog is available."
                : (previousMessage == null
                    ? "Using the bundled signature catalog."
                    : previousMessage);
            return;
        }

        try {
            SignatureDatabase updated = SignatureDatabase.fromSignedJson(
                storedUpdate,
                trustedUpdatePublicKey
            );
            if (bundled != null && updated.generatedAtMillis <= bundled.generatedAtMillis) {
                throw new SecurityException("The installed signature update is older than the bundled catalog.");
            }
            database = updated;
            databaseError = null;
            updateStatus = "current";
            updateMessage = "Authenticated signature update active.";
        } catch (Exception error) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(PREF_SIGNED_UPDATE)
                .putString(PREF_UPDATE_STATUS, error instanceof ParseException ? "expired" : "rejected")
                .putString(
                    PREF_UPDATE_MESSAGE,
                    error.getMessage() == null
                        ? "The installed signature update was rejected."
                        : error.getMessage()
                )
                .apply();
            updateStatus = error instanceof ParseException ? "expired" : "rejected";
            updateMessage = error.getMessage() == null
                ? "The installed signature update was rejected; using the bundled catalog."
                : error.getMessage() + " Using the bundled catalog.";
        }
    }

    boolean isAvailable() {
        return database != null && !database.isExpired();
    }

    String getDatabaseVersion() {
        return database == null ? null : database.version;
    }

    String getDatabaseError() {
        if (database != null && database.isExpired()) {
            return "The active signature database has expired. Scanning is disabled.";
        }
        return databaseError;
    }

    String getDatabaseSource() {
        return database == null ? null : database.source;
    }

    String getDatabaseExpiresAt() {
        return database == null ? null : database.expiresAt;
    }

    String getDatabaseGeneratedAt() {
        return database == null ? null : database.generatedAt;
    }

    String getUpdateStatus() {
        return updateStatus;
    }

    String getUpdateMessage() {
        return updateMessage;
    }

    long getLastUpdateAt() {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getLong(PREF_LAST_UPDATE_AT, 0L);
    }

    boolean installSignedUpdate(String signedUpdate) {
        if (signedUpdate == null ||
            signedUpdate.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_SIGNED_UPDATE_BYTES) {
            updateStatus = "rejected";
            updateMessage = "The signature update is larger than the 4 MB limit.";
            return false;
        }
        try {
            SignatureDatabase candidate = SignatureDatabase.fromSignedJson(
                signedUpdate,
                trustedUpdatePublicKey
            );
            if (database != null && candidate.generatedAtMillis <= database.generatedAtMillis) {
                throw new SecurityException("The signature update is not newer than the active catalog.");
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_SIGNED_UPDATE, signedUpdate)
                .putString(PREF_UPDATE_STATUS, "current")
                .putString(PREF_UPDATE_MESSAGE, "Authenticated signature update active.")
                .putLong(PREF_LAST_UPDATE_AT, System.currentTimeMillis())
                .apply();
            database = candidate;
            databaseError = null;
            updateStatus = "current";
            updateMessage = "Authenticated signature update active.";
            return true;
        } catch (Exception error) {
            updateStatus = error instanceof ParseException ? "expired" : "rejected";
            updateMessage = error.getMessage() == null
                ? "The signature update was rejected."
                : error.getMessage();
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_UPDATE_STATUS, updateStatus)
                .putString(PREF_UPDATE_MESSAGE, updateMessage)
                .apply();
            return false;
        }
    }

    String getUpdateFailureMessage() {
        return updateMessage;
    }

    void clearSignatureUpdateForTesting() {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(PREF_SIGNED_UPDATE)
            .remove(PREF_UPDATE_STATUS)
            .remove(PREF_UPDATE_MESSAGE)
            .remove(PREF_LAST_UPDATE_AT)
            .commit();
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
        android.content.SharedPreferences preferences =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray previous = readScanHistory(preferences);
        JSONArray history = new JSONArray();
        history.put(result.toJson());
        for (int index = 0; index < previous.length() && index < MAX_SCAN_HISTORY - 1; index++) {
            Object entry = previous.opt(index);
            if (entry instanceof JSONObject) {
                history.put(entry);
            }
        }
        preferences.edit()
            .putString(PREF_SCAN_HISTORY, history.toString())
            .putString(PREF_LAST_SCAN, result.toJson().toString())
            .apply();
    }

    JSONObject getLastScan() {
        android.content.SharedPreferences preferences =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray history = readScanHistory(preferences);
        if (history.length() > 0 && history.opt(0) instanceof JSONObject) {
            return history.optJSONObject(0);
        }
        String stored = preferences.getString(PREF_LAST_SCAN, null);
        if (stored == null) {
            return null;
        }
        try {
            return new JSONObject(stored);
        } catch (JSONException error) {
            return null;
        }
    }

    JSONArray getScanHistory() {
        return readScanHistory(
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        );
    }

    void clearScanHistory() {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(PREF_SCAN_HISTORY)
            .remove(PREF_LAST_SCAN)
            .commit();
    }

    long getQuarantineBytes() {
        long total = 0;
        for (File file : quarantineFiles()) {
            total += file.length();
        }
        return total;
    }

    JSONArray getQuarantineMetadata() {
        JSONArray result = new JSONArray();
        JSONArray history = getScanHistory();
        for (File file : quarantineFiles()) {
            String digest = file.getName().substring(0, file.getName().length() - 4);
            JSONObject metadata = new JSONObject();
            JSONObject matchingScan = findHistoryEntry(history, digest);
            try {
                metadata.put("sha256", digest);
                metadata.put("fileName", file.getName());
                metadata.put("sizeBytes", file.length());
                metadata.put("quarantinedAt", file.lastModified());
                if (matchingScan != null) {
                    copyJsonValue(matchingScan, metadata, "verdict");
                    copyJsonValue(matchingScan, metadata, "displayName");
                    copyJsonValue(matchingScan, metadata, "packageName");
                    copyJsonValue(matchingScan, metadata, "versionName");
                    copyJsonValue(matchingScan, metadata, "signatureVersion");
                    copyJsonValue(matchingScan, metadata, "threatType");
                    copyJsonValue(matchingScan, metadata, "severity");
                    copyJsonValue(matchingScan, metadata, "threatName");
                    copyJsonValue(matchingScan, metadata, "details");
                    copyJsonValue(matchingScan, metadata, "scannedAt");
                } else {
                    metadata.put("verdict", VERDICT_MALICIOUS);
                }
                result.put(metadata);
            } catch (JSONException ignored) {
                // Skip only malformed metadata; the quarantine file remains private.
            }
        }
        return result;
    }

    boolean deleteQuarantinedFile(String sha256) {
        if (!isValidDigest(sha256)) {
            return false;
        }
        try {
            File directory = quarantineDirectory().getCanonicalFile();
            File candidate = new File(directory, sha256.toLowerCase(Locale.US) + ".apk")
                .getCanonicalFile();
            if (!directory.equals(candidate.getParentFile()) || !candidate.isFile()) {
                return false;
            }
            return candidate.delete();
        } catch (IOException error) {
            return false;
        }
    }

    private JSONArray readScanHistory(android.content.SharedPreferences preferences) {
        JSONArray history = new JSONArray();
        String stored = preferences.getString(PREF_SCAN_HISTORY, null);
        if (stored != null) {
            try {
                JSONArray parsed = new JSONArray(stored);
                for (int index = 0; index < parsed.length() && index < MAX_SCAN_HISTORY; index++) {
                    Object entry = parsed.opt(index);
                    if (entry instanceof JSONObject) {
                        history.put(entry);
                    }
                }
                return history;
            } catch (JSONException ignored) {
                // Fall through to the legacy last-scan value.
            }
        }
        String legacy = preferences.getString(PREF_LAST_SCAN, null);
        if (legacy != null) {
            try {
                history.put(new JSONObject(legacy));
            } catch (JSONException ignored) {
                // Corrupt local history is treated as empty and can be replaced by the next scan.
            }
        }
        return history;
    }

    private File[] quarantineFiles() {
        File directory = quarantineDirectory();
        final File canonicalDirectory;
        try {
            canonicalDirectory = directory.getCanonicalFile();
        } catch (IOException error) {
            return new File[0];
        }
        File[] files = directory.listFiles((file, name) ->
            name != null &&
            name.endsWith(".apk") &&
            isValidDigest(name.substring(0, name.length() - 4)) &&
            isInsideQuarantine(file, name, canonicalDirectory)
        );
        return files == null ? new File[0] : files;
    }

    private boolean isInsideQuarantine(File directory, String name, File canonicalDirectory) {
        try {
            return canonicalDirectory.equals(new File(directory, name).getCanonicalFile().getParentFile());
        } catch (IOException error) {
            return false;
        }
    }

    private File quarantineDirectory() {
        return new File(context.getFilesDir(), "quarantine");
    }

    private boolean isValidDigest(String digest) {
        return digest != null && digest.matches("^[0-9a-fA-F]{64}$");
    }

    private JSONObject findHistoryEntry(JSONArray history, String digest) {
        for (int index = 0; index < history.length(); index++) {
            JSONObject entry = history.optJSONObject(index);
            if (entry != null && digest.equalsIgnoreCase(entry.optString("sha256", null))) {
                return entry;
            }
        }
        return null;
    }

    private void copyJsonValue(JSONObject source, JSONObject destination, String key)
        throws JSONException {
        if (source.has(key)) {
            destination.put(key, source.opt(key));
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
        File quarantineDirectory = quarantineDirectory();
        if (!quarantineDirectory.isDirectory() && !quarantineDirectory.mkdirs()) {
            return;
        }
        if (!isValidDigest(sha256)) {
            return;
        }
        File destination = new File(quarantineDirectory, sha256.toLowerCase(Locale.US) + ".apk");
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
        final String source;
        final String sourceUrl;
        final String generatedAt;
        final long generatedAtMillis;
        final String expiresAt;
        final long expiresAtMillis;
        final List<SignatureEntry> signatures;

        private SignatureDatabase(
            String version,
            String source,
            String sourceUrl,
            String generatedAt,
            long generatedAtMillis,
            String expiresAt,
            long expiresAtMillis,
            List<SignatureEntry> signatures
        ) {
            this.version = version;
            this.source = source;
            this.sourceUrl = sourceUrl;
            this.generatedAt = generatedAt;
            this.generatedAtMillis = generatedAtMillis;
            this.expiresAt = expiresAt;
            this.expiresAtMillis = expiresAtMillis;
            this.signatures = signatures;
        }

        boolean isExpired() {
            return expiresAtMillis <= System.currentTimeMillis();
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
            int schemaVersion = root.optInt("schemaVersion", 1);
            String version = root.optString("version", "").trim();
            String source = root.optString("source", "SafeNet offline signature catalog").trim();
            String sourceUrl = root.optString("sourceUrl", "").trim();
            String generatedAt = root.optString("generatedAt", "").trim();
            String expiresAt = root.optString("expiresAt", "").trim();
            if (schemaVersion != 1 || version.isEmpty() || expiresAt.isEmpty()) {
                throw new JSONException("The signature database has no version or expiry.");
            }
            long generatedAtMillis = generatedAt.isEmpty()
                ? 0L
                : parseDate(generatedAt);
            long expiresAtMillis = parseDate(expiresAt);
            if (expiresAtMillis <= System.currentTimeMillis()) {
                throw new ParseException("The signature database is expired.", 0);
            }

            JSONArray entries = root.optJSONArray("signatures");
            if (entries == null || entries.length() == 0) {
                throw new JSONException("The signature database contains no signatures.");
            }

            List<SignatureEntry> signatures = new ArrayList<>();
            for (int index = 0; index < entries.length(); index++) {
                JSONObject entry = entries.getJSONObject(index);
                String id = entry.optString("id", "").trim();
                String type = entry.optString("type", "").trim();
                String value = entry.optString("value", "");
                if (id.isEmpty() || value.isEmpty() ||
                    (!"sha256".equals(type) && !"content".equals(type) && !"content_base64".equals(type))) {
                    throw new JSONException("The signature database contains an invalid entry.");
                }
                if ("content_base64".equals(type)) {
                    try {
                        if (android.util.Base64.decode(value, android.util.Base64.DEFAULT).length == 0) {
                            throw new JSONException("The signature database contains an invalid entry.");
                        }
                    } catch (IllegalArgumentException error) {
                        throw new JSONException("The signature database contains an invalid entry.");
                    }
                }
                signatures.add(new SignatureEntry(
                    id,
                    type,
                    value,
                    entry.optString("threatType", "malware"),
                    entry.optString("severity", "high"),
                    entry.optString("description", "A known threat signature matched.")
                ));
            }
            return new SignatureDatabase(
                version,
                source.isEmpty() ? "SafeNet offline signature catalog" : source,
                sourceUrl,
                generatedAt,
                generatedAtMillis,
                expiresAt,
                expiresAtMillis,
                signatures
            );
        }

        static SignatureDatabase fromSignedJson(String signedJson, String publicKey)
            throws JSONException, ParseException {
            JSONObject envelope = new JSONObject(signedJson);
            String payload = envelope.optString("payload", "");
            String signature = envelope.optString("signature", "");
            String algorithm = envelope.optString("algorithm", "SHA256withRSA");
            if (payload.isEmpty() || signature.isEmpty() || !"SHA256withRSA".equals(algorithm)) {
                throw new SecurityException("The signature update envelope is incomplete.");
            }
            if (!verify(payload, signature, publicKey)) {
                throw new SecurityException("The signature update could not be authenticated.");
            }
            SignatureDatabase database = fromJson(payload);
            if (database.generatedAtMillis <= 0L) {
                throw new JSONException("The signed signature database has no generation time.");
            }
            return database;
        }

        private static boolean verify(String payload, String encodedSignature, String encodedKey) {
            try {
                byte[] keyBytes = android.util.Base64.decode(encodedKey, android.util.Base64.DEFAULT);
                PublicKey publicKey = KeyFactory.getInstance("RSA")
                    .generatePublic(new X509EncodedKeySpec(keyBytes));
                java.security.Signature verifier = java.security.Signature.getInstance("SHA256withRSA");
                verifier.initVerify(publicKey);
                verifier.update(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                return verifier.verify(
                    android.util.Base64.decode(encodedSignature, android.util.Base64.DEFAULT)
                );
            } catch (Exception error) {
                return false;
            }
        }

        SignatureMatch findMatch(String sha256, byte[] inspectedContent) {
            String content = new String(inspectedContent, java.nio.charset.StandardCharsets.ISO_8859_1);
            for (SignatureEntry signature : signatures) {
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
            format.setLenient(false);
            Date date = format.parse(value);
            return date.getTime();
        }
    }

    private static final class SignatureEntry {
        final String id;
        final String type;
        final String value;
        final String threatType;
        final String severity;
        final String description;

        SignatureEntry(
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