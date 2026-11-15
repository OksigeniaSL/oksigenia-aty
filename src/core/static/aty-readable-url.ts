// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
/**
 * An address as a person reads it before leaving the app: its site and its path, without what follows the «?» or the
 * «#». A link that fills a message (https://wa.me/?text=…) would otherwise show a long encoded text in the warning.
 * The site is what the warning is for: where the person is going.
 *
 * @param url The address, already without its tokens.
 * @returns The address to show.
 */
export function atyReadableUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }

    let path = parsed.pathname === '/' ? '' : parsed.pathname;
    try {
        path = decodeURI(path);
    } catch {
        // Keep it as it is.
    }

    return parsed.origin + path;
}
