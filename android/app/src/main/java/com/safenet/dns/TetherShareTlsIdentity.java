package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.GeneralName;
import org.bouncycastle.asn1.x509.GeneralNames;
import org.bouncycastle.asn1.x509.KeyUsage;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;

import java.io.ByteArrayInputStream;
import java.math.BigInteger;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;
import java.util.Locale;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocketFactory;
import java.security.KeyStore;

/** Per-device local TLS identity for the Internet Share proxy. */
final class TetherShareTlsIdentity {
    private static final String PREFS = "safenet_tether_tls";
    private static final String PASSWORD = "safenet-local-proxy";

    final SSLServerSocketFactory socketFactory;
    final String certificatePem;
    final String fingerprint;

    private TetherShareTlsIdentity(
        SSLServerSocketFactory socketFactory,
        String certificatePem,
        String fingerprint
    ) {
        this.socketFactory = socketFactory;
        this.certificatePem = certificatePem;
        this.fingerprint = fingerprint;
    }

    static TetherShareTlsIdentity loadOrCreate(Context context, String host) throws Exception {
        String key = "identity_" + host.replaceAll("[^A-Za-z0-9]", "_");
        MasterKey masterKey = new MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();
        SharedPreferences preferences = EncryptedSharedPreferences.create(
            context,
            PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
        String stored = preferences.getString(key, null);
        KeyPair pair;
        X509Certificate certificate;
        if (stored != null) {
            String[] parts = stored.split("\\n", 2);
            if (parts.length != 2) throw new IllegalStateException("Stored TLS identity is invalid.");
            byte[] privateBytes = Base64.getDecoder().decode(parts[0]);
            byte[] certificateBytes = Base64.getDecoder().decode(parts[1]);
            pair = new KeyPair(
                null,
                KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(privateBytes))
            );
            certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(certificateBytes));
        } else {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048, new SecureRandom());
            pair = generator.generateKeyPair();
            certificate = createCertificate(pair, host);
            String encoded = Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()) +
                "\n" + Base64.getEncoder().encodeToString(certificate.getEncoded());
            if (!preferences.edit().putString(key, encoded).commit()) {
                throw new IllegalStateException("Could not save the local TLS identity.");
            }
        }
        return create(pair.getPrivate(), certificate);
    }

    static X509Certificate createCertificate(KeyPair pair, String host) throws Exception {
        long now = System.currentTimeMillis();
        X500Name subject = new X500Name("CN=SafeNet Internet Share");
        BigInteger serial = new BigInteger(160, new SecureRandom()).abs().add(BigInteger.ONE);
        JcaX509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
            subject,
            serial,
            new Date(now - 60_000L),
            new Date(now + 3650L * 24 * 60 * 60 * 1000),
            subject,
            pair.getPublic()
        );
        builder.addExtension(Extension.basicConstraints, true, new BasicConstraints(true));
        builder.addExtension(
            Extension.keyUsage,
            true,
            new KeyUsage(KeyUsage.digitalSignature | KeyUsage.keyEncipherment | KeyUsage.keyCertSign)
        );
        builder.addExtension(
            Extension.subjectAlternativeName,
            false,
            new GeneralNames(new GeneralName(GeneralName.iPAddress, InetAddress.getByName(host).getHostAddress()))
        );
        ContentSigner signer = new JcaContentSignerBuilder("SHA256withRSA").build(pair.getPrivate());
        X509CertificateHolder holder = builder.build(signer);
        X509Certificate certificate = new JcaX509CertificateConverter().getCertificate(holder);
        certificate.verify(pair.getPublic());
        return certificate;
    }

    static TetherShareTlsIdentity create(
        PrivateKey privateKey,
        X509Certificate certificate
    ) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        keyStore.load(null, null);
        keyStore.setKeyEntry("safenet-proxy", privateKey, PASSWORD.toCharArray(),
            new java.security.cert.Certificate[] { certificate });
        KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(keyStore, PASSWORD.toCharArray());
        SSLContext ssl = SSLContext.getInstance("TLS");
        ssl.init(keyManagers.getKeyManagers(), null, new SecureRandom());
        String pem = "-----BEGIN CERTIFICATE-----\n" +
            Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(certificate.getEncoded()) +
            "\n-----END CERTIFICATE-----";
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder fingerprint = new StringBuilder();
        for (byte value : digest) {
            if (fingerprint.length() > 0) fingerprint.append(':');
            fingerprint.append(String.format(Locale.US, "%02X", value & 0xff));
        }
        return new TetherShareTlsIdentity(ssl.getServerSocketFactory(), pem, fingerprint.toString());
    }
}
