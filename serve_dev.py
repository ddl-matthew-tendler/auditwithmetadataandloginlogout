#!/usr/bin/env python3
"""Minimal dev server that proxies to the FastAPI backend or serves static files.
Used only for local preview when uvicorn can't run in sandbox."""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self):
        if self.path.startswith("/static/"):
            self.path = self.path[len("/static"):]
            return super().do_GET()
        if self.path.startswith("/api/"):
            # Proxy to FastAPI
            import urllib.request
            import json
            try:
                url = f"http://localhost:8889{self.path}"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req) as resp:
                    data = resp.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                import json as j
                self.wfile.write(j.dumps({"detail": str(e)}).encode())
            return
        # SPA fallback
        self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            import urllib.request
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length else b""
            try:
                url = f"http://localhost:8889{self.path}"
                req = urllib.request.Request(url, data=body, method="POST")
                req.add_header("Content-Type", "application/json")
                with urllib.request.urlopen(req) as resp:
                    data = resp.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                import json as j
                self.wfile.write(j.dumps({"detail": str(e)}).encode())
            return

    def log_message(self, format, *args):
        pass  # Quiet

print(f"Dev server on http://localhost:{PORT}")
http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
