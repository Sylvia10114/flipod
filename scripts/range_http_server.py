#!/usr/bin/env python3
import os
import re
import sys
import socket
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        ctype = self.guess_type(path)
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        fs = os.fstat(f.fileno())
        size = fs.st_size
        start = 0
        end = size - 1
        status = HTTPStatus.OK

        range_header = self.headers.get("Range")
        if range_header:
            match = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if not match:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                f.close()
                return None

            start_str, end_str = match.groups()
            if start_str:
                start = int(start_str)
            if end_str:
                end = int(end_str)
            if start_str == "" and end_str:
                suffix_length = int(end_str)
                start = max(0, size - suffix_length)
                end = size - 1

            if start > end or start >= size:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                f.close()
                return None

            end = min(end, size - 1)
            status = HTTPStatus.PARTIAL_CONTENT

        content_length = end - start + 1
        self.send_response(status)
        self.send_header("Content-type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()

        self.range = (start, end)
        return f

    def copyfile(self, source, outputfile):
        range_to_send = getattr(self, "range", None)
        if not range_to_send:
            return super().copyfile(source, outputfile)

        start, end = range_to_send
        source.seek(start)
        remaining = end - start + 1
        bufsize = 64 * 1024
        while remaining > 0:
            chunk = source.read(min(bufsize, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


class IPv6ThreadingHTTPServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        except OSError:
            pass
        super().server_bind()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    servers = [
        ThreadingHTTPServer(("0.0.0.0", port), RangeRequestHandler),
        IPv6ThreadingHTTPServer(("::", port), RangeRequestHandler),
    ]
    print(f"Serving HTTP with Range support on port {port} (IPv4 + IPv6)")
    threads = []
    for server in servers:
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        threads.append(t)
    try:
        for t in threads:
            t.join()
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
