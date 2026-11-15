#!/usr/bin/env python3
# (C) Copyright 2026 Oksigenia SL
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Set Aty's version everywhere it lives, so the stores, "About" and the user agent say the same.

Usage: python3 -B scripts/aty-version.py 5.2.4 52109
       python3 -B scripts/aty-version.py --check

The places: config.xml (version, versionCode, android-versionCode, ios-CFBundleVersion, CFBundleShortVersionString and
the user agent), moodle.config.json (versionname, versioncode), package.json and package-lock.json (version).
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def places(name: str, code: str) -> list[tuple[str, str, str]]:
    """The file, a pattern for what is there and what goes there."""
    return [
        ('config.xml', r'(<widget[^>]*?\sversion=")[^"]*(")', rf'\g<1>{name}\g<2>'),
        ('config.xml', r'(<widget[^>]*?\sversionCode=")[^"]*(")', rf'\g<1>{code}\g<2>'),
        ('config.xml', r'(<widget[^>]*?\sandroid-versionCode=")[^"]*(")', rf'\g<1>{code}\g<2>'),
        ('config.xml', r'(<widget[^>]*?\sios-CFBundleVersion=")[^"]*(")', rf'\g<1>{name}.0\g<2>'),
        ('config.xml', r'(target="CFBundleShortVersionString">\s*<string>)[^<]*(</string>)', rf'\g<1>{name}\g<2>'),
        ('config.xml', r'(name="AppendUserAgent" value="MoodleMobile )[^"]*(")', rf'\g<1>{name} ({code})\g<2>'),
        ('moodle.config.json', r'("versionname":\s*")[^"]*(")', rf'\g<1>{name}\g<2>'),
        ('moodle.config.json', r'("versioncode":\s*)\d+', rf'\g<1>{code}'),
        ('package.json', r'^(\{\s*"name":\s*"[^"]*",\s*"version":\s*")[^"]*(")', rf'\g<1>{name}\g<2>'),
        ('package-lock.json', r'^(\{\s*"name":\s*"[^"]*",\s*"version":\s*")[^"]*(")', rf'\g<1>{name}\g<2>'),
        ('package-lock.json', r'("packages":\s*\{\s*"":\s*\{\s*"name":\s*"[^"]*",\s*"version":\s*")[^"]*(")',
            rf'\g<1>{name}\g<2>'),
    ]


def current() -> tuple[str, str]:
    """The version in config.xml, which is what the stores get."""
    text = (ROOT / 'config.xml').read_text(encoding='utf-8')
    name = re.search(r'<widget[^>]*?\sversion="([^"]*)"', text).group(1)
    code = re.search(r'<widget[^>]*?\sversionCode="([^"]*)"', text).group(1)
    return name, code


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == '--check':
        name, code = current()
        wrong = []
        for file, pattern, replacement in places(name, code):
            text = (ROOT / file).read_text(encoding='utf-8')
            found = re.search(pattern, text, re.S)
            if not found or re.sub(pattern, replacement, found.group(0), count=1, flags=re.S) != found.group(0):
                wrong.append(f'{file}: {found.group(0) if found else "not found"}')
        for line in wrong:
            print(f'Not {name} ({code}): {line}')
        return 1 if wrong else 0

    if len(sys.argv) != 3 or not re.fullmatch(r'\d+\.\d+\.\d+', sys.argv[1]) or not sys.argv[2].isdigit():
        print(__doc__.strip().split('\n\n')[1])
        return 2
    name, code = sys.argv[1], sys.argv[2]
    for file, pattern, replacement in places(name, code):
        path = ROOT / file
        text = path.read_text(encoding='utf-8')
        new, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
        if count != 1:
            print(f'Not found in {file}: {pattern}')
            return 1
        path.write_text(new, encoding='utf-8')
    json.loads((ROOT / 'moodle.config.json').read_text(encoding='utf-8'))
    print(f'Aty {name} ({code}) everywhere.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
