#!/usr/bin/env python3
"""Relay a local CLI PTY, changing only OSC 0/2 titles. Never record its output."""
import argparse
import errno
import fcntl
import os
import pty
import select
import signal
import sys
import termios
import tty
import unicodedata


def clean(text):
    return ' '.join(''.join(c for c in text if unicodedata.category(c) not in ('Cc', 'Cf')).split())[:240]


class TitleRelay:
    def __init__(self, project):
        self.project = clean(project)
        self.pending = b''

    def title(self, name=''):
        name = clean(name)
        # Codex may emit only a Braille spinner while generating the first name.
        # Keep the placeholder until a name exists; don't show spinner/UUID guesses.
        if name and name[-1] in '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏':
            name = name[:-1].rstrip()
        name = name or '未选择会话'
        return ('\x1b]0;Codex: ' + name + ': ' + self.project + '\x07').encode()

    def feed(self, data, final=False):
        self.pending += data
        output = bytearray()
        while self.pending:
            start = self.pending.find(b'\x1b]')
            if start < 0:
                keep = 1 if not final and self.pending.endswith(b'\x1b') else 0
                output.extend(self.pending[:-keep] if keep else self.pending)
                self.pending = self.pending[-keep:] if keep else b''
                break
            output.extend(self.pending[:start])
            self.pending = self.pending[start:]
            bell = self.pending.find(b'\x07', 2)
            st = self.pending.find(b'\x1b\\', 2)
            endings = [(bell, 1), (st, 2)]
            endings = [(position, size) for position, size in endings if position >= 0]
            if not endings:
                if final or len(self.pending) > 65536:
                    output.extend(self.pending)
                    self.pending = b''
                break
            end, size = min(endings)
            sequence = self.pending[:end + size]
            content = self.pending[2:end]
            code, separator, title = content.partition(b';')
            if separator and code in (b'0', b'2'):
                output.extend(self.title(title.decode('utf-8', errors='replace')))
            else:
                output.extend(sequence)
            self.pending = self.pending[end + size:]
        return bytes(output)


def write_all(fd, data):
    while data:
        size = os.write(fd, data)
        data = data[size:]


def run(project, command):
    if not os.isatty(0) or not os.isatty(1):
        raise RuntimeError('会话标题功能需要交互式 Bash 终端。')
    relay = TitleRelay(project)
    write_all(1, relay.title())
    saved = termios.tcgetattr(0)
    gate_read, gate_write = os.pipe()
    pid, master = pty.fork()
    if pid == 0:
        os.close(gate_write)
        os.read(gate_read, 1)
        os.close(gate_read)
        try:
            os.execvp(command[0], command)
        except OSError as error:
            print('[Workspace Dock] ' + str(error), file=sys.stderr, flush=True)
            os._exit(127)
    os.close(gate_read)

    def resize(*_):
        try:
            dimensions = fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8)
            fcntl.ioctl(master, termios.TIOCSWINSZ, dimensions)
        except OSError:
            pass

    def forward(signum, _frame):
        try:
            os.killpg(pid, signum)
        except ProcessLookupError:
            pass

    handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGWINCH, signal.SIGTERM, signal.SIGHUP)}
    for sig in handlers:
        signal.signal(sig, resize if sig == signal.SIGWINCH else forward)
    resize()
    tty.setraw(0)
    os.write(gate_write, b'1')
    os.close(gate_write)
    inputs = [0, master]
    try:
        while True:
            ready, _, _ = select.select(inputs, [], [])
            if master in ready:
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not data:
                    break
                write_all(1, relay.feed(data))
            if 0 in ready:
                data = os.read(0, 65536)
                if data:
                    try:
                        write_all(master, data)
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                        break
                else:
                    inputs.remove(0)
        write_all(1, relay.feed(b'', final=True))
    finally:
        termios.tcsetattr(0, termios.TCSADRAIN, saved)
        os.close(master)
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
    _, status = os.waitpid(pid, 0)
    write_all(1, relay.title('已退出'))
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('missing CLI command')
    try:
        sys.exit(run(args.project, command))
    except (RuntimeError, OSError) as error:
        print('[Workspace Dock] ' + str(error), file=sys.stderr)
        sys.exit(1)
