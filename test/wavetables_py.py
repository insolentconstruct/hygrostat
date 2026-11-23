# Copyright 2026 Insolent Construct. MIT licence: see LICENSE.
#
# Runs Mutable Instruments' Python 2 beads/resources/wavetables.py under
# Python 3 and writes its integrated_waves as int16 LE to stdout.
import struct
import sys

SUBSTITUTIONS = [
  ('import pylab\n', ''),
  ("file('beads/resources/waves.bin', 'rb')", "open('beads/resources/waves.bin', 'rb')"),
  ('numpy.fromstring(', 'numpy.frombuffer('),
  ('xrange(', 'range('),
  ('return map(fn, arguments)', 'return list(map(fn, arguments))'),
  ('i + n / 3', 'i + n // 3'),
]

source = open(sys.argv[1]).read()
for old, new in SUBSTITUTIONS:
  if old not in source:
    sys.exit('wavetables.py changed: %r not found' % old)
  source = source.replace(old, new)
scope = {}
exec(compile(source, sys.argv[1], 'exec'), scope)
name, data = scope['wavetables'][0]
assert name == 'integrated_waves'
sys.stdout.buffer.write(struct.pack('<%dh' % len(data), *data))
