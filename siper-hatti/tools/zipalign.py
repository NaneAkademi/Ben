#!/usr/bin/env python3
"""Minimal zipalign: rewrites a zip so every STORED entry's data starts on a
4-byte boundary (.so files on 4096), using the 0xD935 alignment extra field
that Android's own zipalign writes. Used only when the Android SDK is absent."""
import struct
import sys
import zipfile


def align(src, dst):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            out.compress_type = info.compress_type
            out.external_attr = info.external_attr
            out.create_system = info.create_system
            if info.compress_type == zipfile.ZIP_STORED:
                want = 4096 if info.filename.endswith(".so") else 4
                offset = zout.fp.tell()
                base = offset + 30 + len(info.filename.encode("utf-8")) + 6
                pad = (-base) % want
                out.extra = struct.pack("<HHH", 0xD935, 2 + pad, want) + b"\0" * pad
            zout.writestr(out, data)


def check(path):
    bad = []
    with open(path, "rb") as f, zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                continue
            f.seek(info.header_offset)
            h = f.read(30)
            n, e = struct.unpack("<HH", h[26:30])
            start = info.header_offset + 30 + n + e
            want = 4096 if info.filename.endswith(".so") else 4
            if start % want:
                bad.append(info.filename)
    return bad


if __name__ == "__main__":
    if sys.argv[1] == "-c":
        b = check(sys.argv[2])
        if b:
            print("hizasiz:", b)
            sys.exit(1)
        print("hizalama tamam")
    else:
        align(sys.argv[1], sys.argv[2])
