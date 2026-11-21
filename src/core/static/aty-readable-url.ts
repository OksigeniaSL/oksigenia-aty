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
        return escapeHtml(url);
    }

    let path = parsed.pathname === '/' ? '' : parsed.pathname;
    try {
        path = decodeURI(path);
    } catch {
        // Keep it as it is.
    }
    // The warning is HTML: a decoded path could carry tags (a second, fake destination) or control and bidirectional
    // characters that turn the text around. They go, and what is left is escaped.
    // eslint-disable-next-line no-control-regex
    path = path.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');

    return escapeHtml(parsed.origin + path);
}

/**
 * Text made safe inside HTML.
 *
 * @param text The text.
 * @returns The text with its special characters as references.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
