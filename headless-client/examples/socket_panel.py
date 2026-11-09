#!/usr/bin/env python3
"""Attach a display / rotary panel to one talktome-headless instance.

The headless client listens on a Unix socket (JSON lines, protocol 1). Each
line is one JSON object. After connect it sends `hello` then `snapshot`;
further `snapshot` frames are pushed whenever talk/volume/tally changes.

This script is a complete integration example:

* `--once` prints hello + the first snapshot (OLED-style text) and exits.
* `--exec OP` sends one command (see COMMANDS) and prints the ack.
* `--rotary TARGET` simulates a volume encoder: `+` / `-` on stdin step dB.
* default interactive mode paints a live text display and accepts commands.

No third-party packages. Works on the same machine as the service (group
`talktome-headless` must be able to connect to the 0660 socket).

Examples::

    # systemd instance "cam1"
    python3 socket_panel.py --socket /run/talktome-headless/cam1/control.sock

    # development TCP (must be loopback)
    python3 socket_panel.py --tcp 127.0.0.1:9876 --once

    # rotary on conference 1, 0.5 dB per detent
    python3 socket_panel.py --rotary conference:1 --step 0.5

    # one-shot talk press (hold would send release later)
    python3 socket_panel.py --exec 'press user:1'
"""

from __future__ import annotations

import argparse
import json
import os
import selectors
import socket
import sys
import time
from typing import Any, Optional, TextIO

PROTOCOL = 1
DEFAULT_UNIX = os.environ.get("TALKTOME_SOCKET", "")

COMMANDS = """
Commands (interactive and --exec):
  hello [name]                 name this panel (shows up as socket:<name>)
  get                          request a snapshot now
  ping                         round-trip
  press <target>               hold-to-talk down  (user:1 / conference:1 / feed:2 / reply)
  release <target>             hold-to-talk up
  lock <target>                toggle talk lock
  clear-locks
  reply press|release
  mute <target>
  vol <target> <0-1>           linear fader
  voldb <target> <db>          fader in dB (0 = unity, -60 = mute)
  step <target> <delta_db>     rotary tick (negative = down)
  member-mute <conf> <user>
  member-vol <conf> <user> <0-1>
  member-step <conf> <user> <delta_db>
  quit
"""


def default_socket_path() -> str:
    if DEFAULT_UNIX:
        return DEFAULT_UNIX
    runtime = os.environ.get("RUNTIME_DIRECTORY", "")
    if runtime:
        return os.path.join(runtime.split(":")[0], "control.sock")
    instance = os.environ.get("TALKTOME_INSTANCE", "default")
    return f"/tmp/talktome-headless-{instance}-control.sock"


def connect(unix: Optional[str], tcp: Optional[str]) -> socket.socket:
    if tcp:
        host, port_s = tcp.rsplit(":", 1)
        host = host.strip("[]")
        sock = socket.create_connection((host, int(port_s)), timeout=5)
        sock.settimeout(None)
        return sock
    path = unix or default_socket_path()
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(5)
    sock.connect(path)
    sock.settimeout(None)
    return sock


def send(sock: socket.socket, payload: dict[str, Any]) -> None:
    sock.sendall((json.dumps(payload, separators=(",", ":")) + "\n").encode())


def read_json_line(buf: TextIO) -> Optional[dict[str, Any]]:
    line = buf.readline()
    if not line:
        return None
    line = line.strip()
    if not line:
        return read_json_line(buf)
    return json.loads(line)


def fmt_db(volume: Optional[float], volume_db: Optional[float]) -> str:
    if volume_db is None and volume is not None:
        import math

        volume_db = -60.0 if volume <= 1e-6 else 20.0 * math.log10(max(volume, 1e-6))
    if volume_db is None:
        return "  ?"
    if volume_db <= -59.5:
        return "-inf"
    return f"{volume_db:5.1f}"


def paint(snapshot: dict[str, Any]) -> str:
    conn = snapshot.get("connection") or "?"
    flags = []
    if snapshot.get("on_air"):
        flags.append("PGM")
    if snapshot.get("preview"):
        flags.append("PRV")
    if snapshot.get("talking"):
        flags.append("TALK")
    if snapshot.get("lock_active"):
        flags.append("LOCK")
    if snapshot.get("server_not_responding"):
        flags.append("NO SERVER")
    elif snapshot.get("media_status") in ("Media interrupted", "Media failed"):
        flags.append("MEDIA")
    head = f"[{snapshot.get('instance')}] {snapshot.get('user_name') or ''}  {conn}"
    if flags:
        head += "  " + " ".join(flags)
    if snapshot.get("detail"):
        head += f"  ({snapshot['detail']})"
    lines = [head, "-" * min(72, max(24, len(head)))]
    for target in snapshot.get("targets") or []:
        marks = []
        if target.get("held"):
            marks.append("held")
        if target.get("locked"):
            marks.append("lock")
        if target.get("incoming"):
            marks.append("call")
        if target.get("receiving"):
            marks.append("rx")
        if target.get("muted"):
            marks.append("MUTE")
        extra = " ".join(marks)
        db = fmt_db(target.get("volume"), target.get("volume_db"))
        lines.append(
            f"  {target.get('key'):<18} {target.get('name', ''):<16} {db:>6} dB  {extra}"
        )
        for member in target.get("members") or []:
            mdb = fmt_db(member.get("volume"), member.get("volume_db"))
            mmarks = []
            if member.get("muted"):
                mmarks.append("MUTE")
            if member.get("receiving"):
                mmarks.append("rx")
            lines.append(
                f"      {member.get('key'):<14} {member.get('name', ''):<16} {mdb:>6} dB  {' '.join(mmarks)}"
            )
    reply = snapshot.get("reply")
    if snapshot.get("main_unavailable"):
        lines.append("MAIN unavailable")
    elif snapshot.get("main_target"):
        name = (reply or {}).get("name") or ""
        lines.append(f"MAIN {snapshot.get('main_target')}  {name}")
    elif reply:
        lines.append(f"REPLY {reply.get('key')}  {reply.get('name') or ''}")
    return "\n".join(lines)


def parse_exec(text: str, ident: int) -> dict[str, Any]:
    parts = text.strip().split()
    if not parts:
        raise ValueError("empty command")
    op = parts[0].lower()
    if op in ("quit", "exit", "q"):
        return {"op": "quit"}
    if op == "help":
        return {"op": "help"}
    body: dict[str, Any] = {"id": ident}
    if op == "hello":
        body["op"] = "hello"
        if len(parts) > 1:
            body["client"] = parts[1]
        return body
    if op in ("get", "snapshot"):
        body["op"] = "get"
        return body
    if op == "ping":
        body["op"] = "ping"
        return body
    if op == "clear-locks":
        body["op"] = "clear-locks"
        return body
    if op == "reply":
        body["op"] = "reply"
        body["action"] = parts[1] if len(parts) > 1 else "press"
        return body
    if op in ("press", "release", "lock", "mute"):
        if len(parts) < 2:
            raise ValueError(f"{op} needs a target")
        body["op"] = op
        body["target"] = parts[1]
        return body
    if op in ("vol", "volume"):
        body["op"] = "volume"
        body["target"] = parts[1]
        body["value"] = float(parts[2])
        return body
    if op in ("voldb", "volume-db"):
        body["op"] = "volume-db"
        body["target"] = parts[1]
        body["db"] = float(parts[2])
        return body
    if op in ("step", "volume-step"):
        body["op"] = "volume-step"
        body["target"] = parts[1]
        body["delta_db"] = float(parts[2]) if len(parts) > 2 else 3.0
        return body
    if op in ("member-mute",):
        body["op"] = "member-mute"
        body["target"] = parts[1]
        body["member"] = parts[2]
        return body
    if op in ("member-vol", "member-volume"):
        body["op"] = "member-volume"
        body["target"] = parts[1]
        body["member"] = parts[2]
        body["value"] = float(parts[3])
        return body
    if op in ("member-step", "member-volume-step"):
        body["op"] = "member-volume-step"
        body["target"] = parts[1]
        body["member"] = parts[2]
        body["delta_db"] = float(parts[3])
        return body
    raise ValueError(f"unknown command {op!r}\n{COMMANDS}")


def run_once(sock: socket.socket, reader: TextIO) -> int:
    hello = read_json_line(reader)
    snap = read_json_line(reader)
    if not hello or not snap:
        print("socket closed before hello/snapshot", file=sys.stderr)
        return 1
    proto = hello.get("protocol")
    if proto != PROTOCOL:
        print(f"unsupported protocol {proto} (want {PROTOCOL})", file=sys.stderr)
        return 1
    print(json.dumps(hello, indent=2))
    print()
    print(paint(snap))
    return 0


def run_exec(sock: socket.socket, reader: TextIO, command: str, client: str) -> int:
    hello = read_json_line(reader)
    snap = read_json_line(reader)
    if not hello or not snap:
        print("socket closed before hello/snapshot", file=sys.stderr)
        return 1
    send(sock, {"op": "hello", "client": client, "id": 1})
    while True:
        frame = read_json_line(reader)
        if frame is None:
            return 1
        if frame.get("op") == "hello":
            break
    payload = parse_exec(command, 2)
    if payload.get("op") in ("quit", "help"):
        print(COMMANDS)
        return 0
    send(sock, payload)
    deadline = time.time() + 3
    while time.time() < deadline:
        frame = read_json_line(reader)
        if frame is None:
            break
        op = frame.get("op")
        if op in ("ack", "pong", "error"):
            print(json.dumps(frame))
            return 0 if op != "error" else 1
        if op == "snapshot":
            continue
        print(json.dumps(frame))
    print("no ack", file=sys.stderr)
    return 1


def run_loop(sock: socket.socket, reader: TextIO, client: str, rotary: Optional[str], step: float) -> int:
    sel = selectors.DefaultSelector()
    sel.register(sock, selectors.EVENT_READ)
    if sys.stdin.isatty() or rotary:
        sel.register(sys.stdin, selectors.EVENT_READ)
    ident = 1
    send(sock, {"op": "hello", "client": client, "id": ident})
    ident += 1
    if rotary:
        print(f"rotary on {rotary}: type + or - then Enter (step {step} dB). q quits.")
    else:
        print("connected. type help for commands, or q to quit.")
        print(COMMANDS)
    while True:
        for key, _mask in sel.select():
            if key.fileobj is sock:
                frame = read_json_line(reader)
                if frame is None:
                    print("server closed the socket")
                    return 1
                op = frame.get("op")
                if op == "snapshot":
                    print()
                    print(paint(frame))
                    print()
                elif op == "hello":
                    proto = frame.get("protocol")
                    if proto != PROTOCOL:
                        print(f"unsupported protocol {proto}", file=sys.stderr)
                        return 1
                    print(f"hello protocol={proto} instance={frame.get('instance')} endpoint={frame.get('endpoint')}")
                elif op == "error":
                    print(f"error: {frame.get('error')}", file=sys.stderr)
                elif op in ("ack", "pong"):
                    print(op, frame.get("id"))
            else:
                line = sys.stdin.readline()
                if not line:
                    return 0
                text = line.strip()
                if not text:
                    continue
                if rotary and text in ("+", "-", "=", "_"):
                    delta = step if text in ("+", "=") else -step
                    send(sock, {"op": "volume-step", "target": rotary, "delta_db": delta, "id": ident})
                    ident += 1
                    continue
                try:
                    payload = parse_exec(text, ident)
                except (ValueError, IndexError) as error:
                    print(error, file=sys.stderr)
                    continue
                if payload.get("op") == "quit":
                    return 0
                if payload.get("op") == "help":
                    print(COMMANDS)
                    continue
                ident += 1
                send(sock, payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--socket", help="Unix socket path (default: $TALKTOME_SOCKET or $RUNTIME_DIRECTORY/control.sock)")
    parser.add_argument("--tcp", help="loopback TCP host:port instead of Unix")
    parser.add_argument("--client", default="socket-panel", help="name sent in hello (default: socket-panel)")
    parser.add_argument("--once", action="store_true", help="print hello + snapshot and exit")
    parser.add_argument("--exec", metavar="CMD", help="send one command and print the ack")
    parser.add_argument("--rotary", metavar="TARGET", help="map +/− keys to volume-step on TARGET")
    parser.add_argument("--step", type=float, default=3.0, help="dB per rotary detent (default 3)")
    args = parser.parse_args()

    sock = connect(args.socket, args.tcp)
    reader = sock.makefile("r", encoding="utf-8", newline="\n")
    try:
        if args.once:
            return run_once(sock, reader)
        if args.exec:
            return run_exec(sock, reader, args.exec, args.client)
        return run_loop(sock, reader, args.client, args.rotary, args.step)
    finally:
        reader.close()
        sock.close()


if __name__ == "__main__":
    sys.exit(main())
