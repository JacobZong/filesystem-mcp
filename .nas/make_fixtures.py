"""Generate tiny, license-free fixtures for the NAS integration test.

Usage: python3 .nas/make_fixtures.py <out_dir> <image>
The video is produced with the candidate image's own ffmpeg, so the runner
needs nothing but Docker and Python.
"""
import os
import subprocess
import sys
import zipfile

out, image = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

# EPUB: the smallest valid container with one chapter of known text.
with zipfile.ZipFile(os.path.join(out, "sample.epub"), "w") as z:
    z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")
    z.writestr("META-INF/container.xml",
               '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
               '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr("OEBPS/content.opf",
               '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
               '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">nas-fixture</dc:identifier>'
               '<dc:title>NAS Fixture</dc:title><dc:language>en</dc:language></metadata>'
               '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>'
               '<spine><itemref idref="c1"/></spine></package>')
    z.writestr("OEBPS/c1.xhtml",
               '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head>'
               '<body><h1>NAS integration chapter</h1><p>The converter read this EPUB.</p></body></html>')

# PDF: two pages with text, xref offsets computed.
objs = {1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}
for n, pid in enumerate((4, 6), start=1):
    stream = f"BT /F1 24 Tf 20 50 Td (Page {n}) Tj ET"
    objs[pid] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] "
                 f"/Resources << /Font << /F1 3 0 R >> >> /Contents {pid + 1} 0 R >>")
    objs[pid + 1] = f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"
pdf, offsets = "%PDF-1.4\n", {}
for i in sorted(objs):
    offsets[i] = len(pdf)
    pdf += f"{i} 0 obj\n{objs[i]}\nendobj\n"
xref = len(pdf)
pdf += f"xref\n0 {max(objs) + 1}\n0000000000 65535 f \n" + "".join(
    f"{offsets[i]:010d} 00000 n \n" for i in range(1, max(objs) + 1))
pdf += f"trailer\n<< /Size {max(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
open(os.path.join(out, "sample.pdf"), "wb").write(pdf.encode("latin1"))

# Video: 3 s test pattern, made by the image's ffmpeg.
subprocess.run(["docker", "run", "--rm", "--user", f"{os.getuid()}:{os.getgid()}", "--entrypoint", "ffmpeg",
                "-v", f"{os.path.abspath(out)}:/out", image, "-loglevel", "error", "-y", "-f", "lavfi",
                "-i", "testsrc=duration=3:size=320x240:rate=10", "-pix_fmt", "yuv420p", "/out/sample.mp4"], check=True)
# Audio: 1 s tone as MP3 (write_binary round-trip and read-as-audio checks).
subprocess.run(["docker", "run", "--rm", "--user", f"{os.getuid()}:{os.getgid()}", "--entrypoint", "ffmpeg",
                "-v", f"{os.path.abspath(out)}:/out", image, "-loglevel", "error", "-y", "-f", "lavfi",
                "-i", "sine=frequency=440:duration=1", "-codec:a", "libmp3lame", "-q:a", "6", "/out/sample.mp3"],
               check=True)
print("fixtures:", sorted(os.listdir(out)))
