#!/usr/bin/env python3
"""Servidor estático de desarrollo con no-cache (evita ES module caching stale)."""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Sirve siempre desde la carpeta de la app (donde vive este script).
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    HTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
