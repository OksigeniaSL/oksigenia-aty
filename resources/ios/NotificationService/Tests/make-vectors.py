# Random sealed boxes made with libsodium (PyNaCl), one per line, for sealed_box_test.c:
#   open <sk> <box> <message | = for empty>     must open to the message
#   fail <sk> <box>                             must not open (changed byte, or another key)
#   b2 <outlen> <input | -> <digest>            BLAKE2b
# Usage: python3 make-vectors.py [count]
import hashlib
import os
import random
import sys

from nacl.public import PrivateKey, SealedBox

count = int(sys.argv[1]) if len(sys.argv) > 1 else 200
sizes = [0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000, 3000]
for i in range(count):
    key = PrivateKey.generate()
    size = sizes[i % len(sizes)] if i % 2 else random.randint(0, 2000)
    message = os.urandom(size)
    box = SealedBox(key.public_key).encrypt(message)
    print("open", bytes(key).hex(), box.hex(), message.hex() or "=")
    if i % 5 == 0:
        changed = bytearray(box)
        changed[random.randrange(len(changed))] ^= 1 << random.randrange(8)
        print("fail", bytes(key).hex(), bytes(changed).hex())
        print("fail", bytes(PrivateKey.generate()).hex(), box.hex())
for size in [0, 1, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1000]:
    data = os.urandom(size)
    for outlen in (1, 24, 32, 64):
        print("b2", outlen, data.hex() or "-", hashlib.blake2b(data, digest_size=outlen).hexdigest())
