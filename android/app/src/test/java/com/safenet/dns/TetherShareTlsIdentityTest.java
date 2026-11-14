package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;

import org.junit.Test;

public class TetherShareTlsIdentityTest {
    @Test
    public void certificateHasAnIpSanAndCanCompleteAHostnameVerifiedTlsHandshake()
        throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048, new SecureRandom());
        KeyPair pair = generator.generateKeyPair();
        X509Certificate certificate =
            TetherShareTlsIdentity.createCertificate(pair, "127.0.0.1");

        assertTrue(certificate.getBasicConstraints() >= 0);
        Collection<List<?>> names = certificate.getSubjectAlternativeNames();
        assertNotNull(names);
        assertTrue(names.stream().anyMatch(name ->
            Integer.valueOf(7).equals(name.get(0)) &&
                "127.0.0.1".equals(name.get(1))
        ));

        TetherShareTlsIdentity identity =
            TetherShareTlsIdentity.create(pair.getPrivate(), certificate);
        SSLServerSocket server = (SSLServerSocket) identity.socketFactory
            .createServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        server.setEnabledProtocols(new String[] { "TLSv1.2" });
        KeyStore trustStore = KeyStore.getInstance(KeyStore.getDefaultType());
        trustStore.load(null, null);
        trustStore.setCertificateEntry("safenet-test", certificate);
        TrustManagerFactory trustManagers =
            TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trustManagers.init(trustStore);
        SSLContext clientContext = SSLContext.getInstance("TLS");
        clientContext.init(null, trustManagers.getTrustManagers(), new SecureRandom());

        try (server) {
            ExecutorService executor = Executors.newSingleThreadExecutor();
            try {
                Future<Integer> accepted = executor.submit(() -> {
                try (SSLSocket socket = (SSLSocket) server.accept()) {
                    socket.setEnabledProtocols(new String[] { "TLSv1.2" });
                    socket.startHandshake();
                    socket.getOutputStream().write(42);
                    return 42;
                }
            });
                try (SSLSocket client = (SSLSocket) clientContext.getSocketFactory()
                    .createSocket("127.0.0.1", server.getLocalPort())) {
                    SSLParameters parameters = client.getSSLParameters();
                    parameters.setEndpointIdentificationAlgorithm("HTTPS");
                    client.setSSLParameters(parameters);
                    client.setEnabledProtocols(new String[] { "TLSv1.2" });
                    client.startHandshake();
                    assertEquals(42, client.getInputStream().read());
                }
                assertEquals(Integer.valueOf(42), accepted.get());
            } finally {
                executor.shutdownNow();
            }
        }
    }
}
