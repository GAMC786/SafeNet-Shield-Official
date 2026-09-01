#!/usr/bin/env python3
"""Small resolver fixture for the Android release smoke lane.

The fixture intentionally uses only Python's standard library. It returns the
same deterministic A response over plain DNS, DoH, and DoT, and exposes an
HTTPS endpoint for the smoke test's non-DNS connectivity assertion.
"""

import argparse
import http.client
import json
import socket
import socketserver
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler


ANSWER_ADDRESS = "203.0.113.7"
ANSWER_BYTES = socket.inet_aton(ANSWER_ADDRESS)
QUERY = bytes(
    [
        0x53,
        0x4E,
        0x01,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x07,
        ord("s"),
        ord("a"),
        ord("f"),
        ord("e"),
        ord("n"),
        ord("e"),
        ord("t"),
        0x03,
        ord("c"),
        ord("o"),
        ord("m"),
        0x00,
        0x00,
        0x01,
        0x00,
        0x01,
    ]
)


def dns_response(query):
    if len(query) < 12:
        return b""
    question_end = len(query)
    # The smoke query has one question. Preserve the complete question so the
    # response remains a valid DNS packet for the app's forwarding path.
    return (
        query[:2]
        + b"\x81\x80"
        + query[4:6]
        + b"\x00\x01\x00\x00\x00\x00"
        + query[12:question_end]
        + b"\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x3c\x00\x04"
        + ANSWER_BYTES
    )


class ReusableThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class DoTHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(10)
        header = read_exact(self.request, 2)
        length = int.from_bytes(header, "big")
        query = read_exact(self.request, length)
        response = dns_response(query)
        self.request.sendall(len(response).to_bytes(2, "big") + response)


class DoHHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(10)
        request = read_until(self.request, b"\r\n\r\n", 65536)
        header_text = request.decode("iso-8859-1")
        request_line, *header_lines = header_text.split("\r\n")
        headers = {}
        for line in header_lines:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.lower()] = value.strip()
        content_length = int(headers.get("content-length", "0"))
        body = request.split(b"\r\n\r\n", 1)[1]
        if len(body) < content_length:
            body += read_exact(self.request, content_length - len(body))
        path = request_line.split(" ")[1] if len(request_line.split(" ")) > 1 else ""
        if path != "/dns-query" or content_length == 0:
            self.request.sendall(http_response(404, b"not found", b"text/plain"))
            return
        response = dns_response(body[:content_length])
        self.request.sendall(http_response(200, response, b"application/dns-message"))


class PlainHttpHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        body = b"SafeNet Android DNS fixture\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def log_message(self, _format, *_args):
        return


def read_exact(connection, length):
    chunks = []
    remaining = length
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise OSError("connection closed before fixture request completed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_until(connection, marker, limit):
    value = bytearray()
    while marker not in value:
        chunk = connection.recv(4096)
        if not chunk:
            raise OSError("connection closed before fixture headers completed")
        value.extend(chunk)
        if len(value) > limit:
            raise OSError("fixture request headers are too large")
    return bytes(value)


def http_response(status, body, content_type):
    reason = "OK" if status == 200 else "Not Found"
    return (
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n\r\n"
        % (status, reason, content_type.decode("ascii"), len(body))
    ).encode("ascii") + body


def tls_server(port, context, handler):
    server = ReusableThreadingTCPServer(("0.0.0.0", port), handler)
    def get_request():
        connection, address = socketserver.TCPServer.get_request(server)
        return context.wrap_socket(connection, server_side=True), address

    server.get_request = get_request
    return server


def start_server(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def probe_plain(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.settimeout(3)
        connection.sendto(QUERY, (host, port))
        response, _ = connection.recvfrom(65535)
    return ANSWER_BYTES in response


def probe_tls(host, port, doh):
    context = ssl._create_unverified_context()
    with socket.create_connection((host, port), timeout=3) as raw:
        with context.wrap_socket(raw, server_hostname=host) as connection:
            if doh:
                request = (
                    b"POST /dns-query HTTP/1.1\r\n"
                    b"Host: " + host.encode("ascii") + b"\r\n"
                    b"Content-Type: application/dns-message\r\n"
                    b"Content-Length: " + str(len(QUERY)).encode("ascii") + b"\r\n"
                    b"Connection: close\r\n\r\n"
                )
                connection.sendall(request + QUERY)
                response = read_until_connection_close(connection)
                return b" 200 " in response and ANSWER_BYTES in response
            connection.sendall(len(QUERY).to_bytes(2, "big") + QUERY)
            length = int.from_bytes(read_exact(connection, 2), "big")
            return ANSWER_BYTES in read_exact(connection, length)


def probe_http(host, port):
    connection = http.client.HTTPSConnection(
        host, port, timeout=3, context=ssl._create_unverified_context()
    )
    try:
        connection.request("GET", "/")
        response = connection.getresponse()
        return 200 <= response.status < 500
    finally:
        connection.close()


def read_until_connection_close(connection):
    chunks = []
    while True:
        chunk = connection.recv(65536)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


def run_probe(args):
    checks = {
        "plain": probe_plain(args.host, args.plain_port),
        "doh": probe_tls(args.host, args.doh_port, True),
        "dot": probe_tls(args.host, args.dot_port, False),
        "ordinary_http": probe_http(args.host, args.http_port),
    }
    if not all(checks.values()):
        raise RuntimeError("fixture probe failed: " + json.dumps(checks, sort_keys=True))
    print(json.dumps(checks, sort_keys=True))


def run_fixture(args):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.certificate, args.key)
    servers = []
    stop = threading.Event()
    plain_socket = None
    try:
        plain_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        plain_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        plain_socket.bind(("0.0.0.0", args.plain_port))

        def serve_plain():
            while not stop.is_set():
                try:
                    plain_socket.settimeout(1)
                    packet, address = plain_socket.recvfrom(65535)
                    plain_socket.sendto(dns_response(packet), address)
                except socket.timeout:
                    continue
                except OSError:
                    break

        dot_server = tls_server(args.dot_port, context, DoTHandler)
        doh_server = tls_server(args.doh_port, context, DoHHandler)
        http_server = tls_server(args.http_port, context, PlainHttpHandler)
        servers.extend([dot_server, doh_server, http_server])
        threads = [threading.Thread(target=serve_plain, daemon=True)]
        for thread in threads:
            thread.start()
        threads.extend(start_server(server) for server in servers)
        with open(args.ready_file, "w", encoding="utf-8") as ready:
            json.dump(
                {
                    "plain_port": args.plain_port,
                    "doh_port": args.doh_port,
                    "dot_port": args.dot_port,
                    "http_port": args.http_port,
                },
                ready,
            )
        print("Android DNS fixture is ready", flush=True)
        while not stop.wait(1):
            pass
    finally:
        stop.set()
        try:
            if plain_socket is not None:
                plain_socket.close()
        except (NameError, OSError):
            pass
        for server in servers:
            server.shutdown()
            server.server_close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--plain-port", type=int, default=53)
    parser.add_argument("--doh-port", type=int, default=443)
    parser.add_argument("--dot-port", type=int, default=853)
    parser.add_argument("--http-port", type=int, default=18080)
    parser.add_argument("--certificate")
    parser.add_argument("--key")
    parser.add_argument("--ready-file", default="/tmp/android-dns-fixture-ready.json")
    args = parser.parse_args()
    try:
        if args.probe:
            run_probe(args)
        else:
            if not args.certificate or not args.key:
                parser.error("--certificate and --key are required in fixture mode")
            run_fixture(args)
    except Exception as error:
        print("Android DNS fixture failure: %s" % error, file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())