#!/usr/bin/env python3
"""Router tripwire for the trimurti lab: the lab's gateway (.1) plays the router, and the kit
must never log into it. Listens on <listen_ip> for each port, accepts, logs, closes.

Usage: tripwire.py <listen_ip> <log_file> <port> [<port> ...] [trimurti-lab=<name>]

One line per connection, appended to <log_file>:
    <UTC time> <src_ip>:<src_port> -> <port>
followed by  first-bytes="..."  when the client sent something within 1.5 s. An SSH client
sends its version string first, so an SSH attempt reads first-bytes="SSH-2.0-...", while a
bare port probe (nc -z) has no suffix. A source address outside the lab subnet is the Docker
host itself (lab.sh check probes from there; Docker masquerades it), not a lab machine."""
import asyncio
import datetime
import sys


def printable(data):
    out = []
    for b in data[:60]:
        c = chr(b)
        out.append(c if 32 <= b < 127 and c not in '"\\' else "\\x%02x" % b)
    return "".join(out).rstrip()


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("trimurti-lab=")]
    if len(args) < 3:
        sys.exit(__doc__)
    host, log_file, ports = args[0], args[1], [int(p) for p in args[2:]]
    open(log_file, "a").close()

    def handler(port):
        async def handle(reader, writer):
            peer = writer.get_extra_info("peername") or ("?", 0)
            first = b""
            try:
                first = await asyncio.wait_for(reader.read(64), timeout=1.5)
            except Exception:
                pass
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            line = "%s %s:%s -> %d" % (stamp, peer[0], peer[1], port)
            first = first.split(b"\n")[0].rstrip(b"\r")
            if first:
                line += ' first-bytes="%s"' % printable(first)
            with open(log_file, "a") as fh:
                fh.write(line + "\n")
            writer.close()
        return handle

    servers = [await asyncio.start_server(handler(p), host, p) for p in ports]
    print("tripwire listening on %s ports %s, logging to %s" % (host, ports, log_file), flush=True)
    await asyncio.gather(*(s.serve_forever() for s in servers))


asyncio.run(main())
