#!/usr/bin/env python3
"""Exercise title parsing and real PTY IO using a fake CLI, never a real session."""
import errno
import fcntl
import importlib.util
import os
from pathlib import Path
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('codex_title', ROOT / 'codex-title.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TitleChecks(unittest.TestCase):
    def test_split_unicode_title_and_other_sequences(self):
        data = b'\x1b[32mhello' + '\x1b]0;首次对话标题\x07'.encode() + b'\x1b]7;file:///example\x07world'
        expected = b'\x1b[32mhello' + '\x1b]0;Codex: 首次对话标题: project-a\x07'.encode() + b'\x1b]7;file:///example\x07world'
        for cut in range(len(data) + 1):
            relay = module.TitleRelay('project-a')
            self.assertEqual(relay.feed(data[:cut]) + relay.feed(data[cut:], final=True), expected)

    def test_placeholder_rename_switch_and_clear(self):
        relay = module.TitleRelay('project-a')
        self.assertIn('未选择会话', relay.title().decode())
        self.assertIn('未选择会话', relay.title('⠋').decode())
        self.assertIn('Codex: 标题: project-a', relay.title('标题 ⠙').decode())
        for title in ['', '首次自动命名', '用户修改名称', '另一个会话', '']:
            actual = relay.feed(('\x1b]2;' + title + '\x1b\\').encode()).decode()
            self.assertIn(title or '未选择会话', actual)
        self.assertEqual(module.clean('title\x1b\u202e\n'), 'title')

    def test_real_pty_io_resize_exit_and_termios(self):
        with tempfile.TemporaryDirectory() as temp:
            stub = Path(temp) / 'fake_cli.py'
            stub.write_text('''import os, sys
print('TTY=' + str(os.isatty(0) and os.isatty(1)), flush=True)
print('SIZE=' + str(os.get_terminal_size(0).columns), flush=True)
for line in sys.stdin:
    name = line.strip()
    if name == 'exit': sys.exit(7)
    print('\\x1b]0;' + name + '\\x07', end='', flush=True)
    print('SIZE=' + str(os.get_terminal_size(0).columns), flush=True)
''')
            pid, fd = pty.fork()
            if pid == 0:
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
                os.execv(sys.executable, [sys.executable, str(ROOT / 'codex-title.py'),
                    '--project', 'project-a', '--', sys.executable, str(stub)])
            output = bytearray()

            def read_until(needle):
                expected = needle.encode()
                deadline = time.monotonic() + 8
                while expected not in output and time.monotonic() < deadline:
                    ready, _, _ = select.select([fd], [], [], 0.1)
                    if ready:
                        try:
                            chunk = os.read(fd, 65536)
                        except OSError as error:
                            if error.errno == errno.EIO:
                                break
                            raise
                        if not chunk:
                            break
                        output.extend(chunk)
                self.assertIn(expected, output)

            try:
                read_until('TTY=True')
                read_until('SIZE=100')
                self.assertIn('Codex: 未选择会话: project-a'.encode(), output)
                os.write(fd, '首次自动标题\n'.encode())
                read_until('Codex: 首次自动标题: project-a')
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 132, 0, 0))
                os.kill(pid, signal.SIGWINCH)
                os.write(fd, '用户改名\n'.encode())
                read_until('Codex: 用户改名: project-a')
                read_until('SIZE=132')
                os.write(fd, b'exit\n')
                read_until('Codex: 已退出: project-a')
                _, status = os.waitpid(pid, 0)
                self.assertEqual(os.waitstatus_to_exitcode(status), 7)
                modes = termios.tcgetattr(fd)
                self.assertTrue(modes[3] & termios.ICANON)
                self.assertTrue(modes[3] & termios.ECHO)
            finally:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                os.close(fd)


if __name__ == '__main__':
    unittest.main()
