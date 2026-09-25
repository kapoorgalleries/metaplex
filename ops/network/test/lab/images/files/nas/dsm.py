#!/usr/bin/env python3
"""Stand-in for a Synology DSM web login: HTTP on 5000 and, when a certificate was made at
start (/run/lab-nas/*.pem), HTTPS on 5001. Every path answers with the same login page
whose <title> is "Synology DiskStation", so vendor detection by page content can be tested.
It is a lab fixture: there is no login behind it."""
import http.server
import os
import ssl
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "index.html"), "rb") as fh:
    PAGE = fh.read()
CERT, KEY = "/run/lab-nas/cert.pem", "/run/lab-nas/key.pem"


class Handler(http.server.BaseHTTPRequestHandler):
    def version_string(self):
        return "nginx"

    def _page(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(PAGE)))
        self.end_headers()
        if body:
            self.wfile.write(PAGE)

    def do_GET(self):
        self._page(True)

    def do_HEAD(self):
        self._page(False)

    def log_message(self, fmt, *args):
        print("dsm %s:%s %s" % (self.client_address[0], self.server.server_port, fmt % args), flush=True)


def serve(port, tls):
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    srv.serve_forever()


if __name__ == "__main__":
    if os.path.exists(CERT) and os.path.exists(KEY):
        threading.Thread(target=serve, args=(5001, True), daemon=True).start()
    serve(5000, False)
