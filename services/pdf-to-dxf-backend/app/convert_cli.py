"""
Subprocess entry point for a single conversion.

Run as: ``python -m app.convert_cli <pdf_path> <out_path> <fmt>``

main.convert spawns this as a short-lived child process so that ALL memory a
conversion touches -- including one-time OpenCV/scipy warm-up that never gets
freed within a process -- is reclaimed by the OS when the child exits. That
keeps the long-lived server lean and stops RSS ratcheting past the 512MB cap
across successive conversions. The result summary is written next to the
output as ``<out_path>.result.json`` for the parent to read.
"""
import json
import sys

from .tile import pdf_to_dxf_auto


def main() -> None:
    if len(sys.argv) < 4:
        print("usage: python -m app.convert_cli <pdf> <out> <dxf|pdf> [smooth] [simplify]",
              file=sys.stderr)
        sys.exit(2)
    pdf_path, out_path, fmt = sys.argv[1], sys.argv[2], sys.argv[3]
    kw = {}
    if len(sys.argv) >= 5 and sys.argv[4] != "":
        kw["smooth"] = float(sys.argv[4])
    if len(sys.argv) >= 6 and sys.argv[5] != "":
        kw["simplify"] = float(sys.argv[5])
    result = pdf_to_dxf_auto(pdf_path, out_path, fmt=fmt, **kw)
    with open(out_path + ".result.json", "w") as f:
        json.dump({"shape_count": result.get("shape_count", 0),
                   "audit_errors": result.get("audit_errors", 0)}, f)


if __name__ == "__main__":
    main()
