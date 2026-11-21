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

/** Loopback hosts: the local demo during development, reached over adb, which keeps its http. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The address to ask for a resource another site puts in a course (an image, a video, a frame): https for one given as
 * http. No traffic leaves the app in the clear (resources/android/xml/network_security_config.xml), so an http one would
 * break. A browser does the same in an https page: it asks for the http image over https and shows it when that site
 * answers. One that only has http stays broken here, as it does on the web.
 *
 * @param url The resource's address, absolute.
 * @returns The address to use.
 */
export function atyHttpsUrl(url: string): string {
    if (!/^http:\/\//i.test(url)) {
        return url;
    }

    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return url;
    }

    return LOOPBACK.includes(host) ? url : url.replace(/^http:\/\//i, 'https://');
}
