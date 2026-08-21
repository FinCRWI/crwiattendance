#!/usr/bin/env python3
import http.server
import socketserver
import os
from pathlib import Path

PORT = 3004
DIRECTORY = Path(__file__).parent / "dist"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)
    
    def do_GET(self):
        # Handle directory requests by serving index.html
        if self.path.endswith('/'):
            self.path = self.path + 'index.html'
        elif not '.' in self.path.split('/')[-1]:
            self.path = self.path + '/index.html'
        
        # Security: prevent directory traversal
        if '..' in self.path:
            self.send_error(403)
            return
        
        return super().do_GET()

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Test server started at http://localhost:{PORT}/")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
