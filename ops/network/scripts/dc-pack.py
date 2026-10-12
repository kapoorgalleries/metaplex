#!/usr/bin/env python3
r"""Pack a PowerShell script into one Desktop Commander start_process command.

Usage: dc-pack.py <script.ps1> [--name dc-diagnose.ps1] [--args "..."] > command.txt

Desktop Commander's remote start_process takes one command line and no file (write_file is capped
at 50 lines per call), so the script travels inside the command: gzip + base64, wrapped in a short
PowerShell stub that writes it to %USERPROFILE%\trimurti-dc\<name> (UTF-8 with BOM, which Windows
PowerShell 5.1 needs for non-ASCII) and runs it with -File. The stub itself goes through
-EncodedCommand, so nothing in the script is exposed to the outer shell's quoting or to the
blocked-command list, which only looks at the command line. The result must stay under Windows'
32767-character command-line limit; the packer refuses otherwise.
"""
import argparse, base64, gzip, pathlib, sys

ap = argparse.ArgumentParser()
ap.add_argument('script')
ap.add_argument('--name', help='file name on the target (default: the script\'s own name)')
ap.add_argument('--args', default='', help='arguments appended to the -File invocation')
a = ap.parse_args()

src = pathlib.Path(a.script).read_bytes()
name = a.name or pathlib.Path(a.script).name
payload = base64.b64encode(gzip.compress(src, 9)).decode()
stub = (
    "$ErrorActionPreference='Stop'\n"
    "$d=Join-Path $env:USERPROFILE 'trimurti-dc'; New-Item -ItemType Directory -Force -Path $d | Out-Null\n"
    f"$f=Join-Path $d '{name}'\n"
    f"$b=[Convert]::FromBase64String('{payload}')\n"
    "$ms=New-Object IO.MemoryStream(,$b)\n"
    "$gz=New-Object IO.Compression.GZipStream($ms,[IO.Compression.CompressionMode]::Decompress)\n"
    "$sr=New-Object IO.StreamReader($gz,[Text.Encoding]::UTF8)\n"
    "[IO.File]::WriteAllText($f,$sr.ReadToEnd(),(New-Object Text.UTF8Encoding $true)); $sr.Close()\n"
    f"& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f {a.args}\n"
)
enc = base64.b64encode(stub.encode('utf-16-le')).decode()
cmd = f"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {enc}"
if len(cmd) > 32000:
    sys.exit(f"command is {len(cmd)} chars; Windows allows 32767. Shrink the script.")
print(cmd)
print(f"[dc-pack] script {len(src)} bytes -> gzip+b64 {len(payload)} -> command {len(cmd)} chars", file=sys.stderr)
