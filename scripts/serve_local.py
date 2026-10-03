#!/usr/bin/env python3
"""Serve the static app locally, expanding its small Jekyll cache-busting header."""
import argparse
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LocalHTTPServer(ThreadingHTTPServer):
    # A browser loads many independent stylesheets and modules at once. Python
    # 3.13's default backlog of five can reset those connections under CPU load.
    request_queue_size = 128


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / 'index.html'
        if path.suffix not in ('.html', '.js') or not path.is_file():
            return super().do_GET()
        text = path.read_text(encoding='utf-8')
        text = re.sub(r'^---\n---\n', '', text)
        text = re.sub(r'{% assign asset_version = .*?%}', '', text)
        text = text.replace('{{ asset_version }}', 'local')
        data = text.encode('utf-8')
        self.send_response(200)
        mime = 'text/html' if path.suffix == '.html' else 'application/javascript'
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    print(f'Interview Questions: http://127.0.0.1:{args.port}', flush=True)
    LocalHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
