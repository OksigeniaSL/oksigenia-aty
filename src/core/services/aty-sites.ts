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

import { verifyAsync } from '@noble/ed25519';
import { CoreError } from '@classes/errors/error';
import { CoreConfig } from '@services/config';
import { CoreWS } from '@services/ws';
import { Translate } from '@singletons';
import { CoreLogger } from '@static/logger';
import { CoreUrl } from '@static/url';

/**
 * Oksigenia Aty only opens the Moodle sites that Oksigenia hosts.
 *
 * The list comes from Oksigenia's central registry. It holds SHA-256 digests of the sites' hosts, so it does not name
 * the clients, and it is signed with Ed25519, so nobody can slip in a list of their own. The app keeps the last good
 * copy, so it also works offline, and asks for a fresh one when it has expired or when a site is not on it (a client
 * that has just been added).
 */
export class AtySites {

    static readonly LIST_URL = 'https://aravo.oksigenia.com/aty/sitios.json';
    static readonly SIGNATURE_URL = 'https://aravo.oksigenia.com/aty/sitios.json.sig';

    /**
     * Oksigenia's public key for the list (32 raw bytes, base64). While it is empty the check is off and every site is
     * allowed, as before the list existed.
     */
    protected static readonly PUBLIC_KEY = '';

    /** Where the last verified list is kept. */
    protected static readonly CACHE_KEY = 'aty_sites_list';

    /** Loopback hosts: the local demo during development, reached over adb. No real site lives there. */
    protected static readonly LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

    protected static readonly logger = CoreLogger.getInstance('AtySites');

    /**
     * Throw the "not an Oksigenia site" error unless the site is on the list.
     *
     * @param siteUrl The site's URL, with or without protocol.
     */
    static async assertAllowed(siteUrl: string): Promise<void> {
        if (await AtySites.isAllowed(siteUrl)) {
            return;
        }

        throw new CoreError(Translate.instant('core.aty.sitenotallowed'), {
            debug: { code: 'atysitenotallowed', details: `URL: ${siteUrl}` },
        });
    }

    /**
     * Whether a site is one of the sites that Oksigenia hosts.
     *
     * @param siteUrl The site's URL, with or without protocol.
     * @returns Whether the app may open it.
     */
    static async isAllowed(siteUrl: string): Promise<boolean> {
        if (!AtySites.PUBLIC_KEY) {
            return true;
        }

        const host = AtySites.host(siteUrl);
        if (!host) {
            return false;
        }
        if (AtySites.LOOPBACK.includes(host)) {
            return true;
        }

        const digest = await AtySites.sha256Hex(host);
        const cached = await AtySites.cached();
        if (cached && cached.expires * 1000 > Date.now() && cached.sites.includes(digest)) {
            return true;
        }

        const fresh = await AtySites.download();
        if (fresh) {
            return fresh.sites.includes(digest);
        }

        // Offline, or the registry is down: trust the last good list, even when it has expired.
        return !!cached?.sites.includes(digest);
    }

    /**
     * The host the list is keyed by: lower case, without protocol, port or a trailing dot, and in punycode.
     *
     * @param siteUrl The site's URL, with or without protocol.
     * @returns The host, or '' when the URL cannot be read.
     */
    static host(siteUrl: string): string {
        try {
            return new URL(CoreUrl.formatURL(siteUrl)).hostname.toLowerCase().replace(/\.$/, '');
        } catch {
            return '';
        }
    }

    /**
     * The SHA-256 of a text, as lower-case hex.
     *
     * @param text The text.
     * @returns The digest.
     */
    static async sha256Hex(text: string): Promise<string> {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Download the list and its signature, check them and keep the list. The registry may change between the two
     * requests, so a mismatch is retried once.
     *
     * @returns The verified list, or null when it cannot be had.
     */
    protected static async download(): Promise<AtySiteList | null> {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const [json, signature] = await Promise.all([
                    CoreWS.sendHTTPRequest<string>(AtySites.LIST_URL, { method: 'get', responseType: 'text' }),
                    CoreWS.sendHTTPRequest<string>(AtySites.SIGNATURE_URL, { method: 'get', responseType: 'text' }),
                ]);
                const list = await AtySites.verify(String(json.body ?? ''), String(signature.body ?? '').trim());
                if (list) {
                    await CoreConfig.set(AtySites.CACHE_KEY, JSON.stringify(list));

                    return list;
                }
            } catch (error) {
                AtySites.logger.error('Cannot download the list of Oksigenia sites', error);

                return null;
            }
        }

        return null;
    }

    /**
     * Check a list against Oksigenia's key and read it.
     *
     * @param json The list, exactly as served.
     * @param signature Its Ed25519 signature, base64.
     * @returns The list, or null when the signature or the content is not right.
     */
    protected static async verify(json: string, signature: string): Promise<AtySiteList | null> {
        try {
            const valid = await verifyAsync(
                AtySites.fromBase64(signature),
                new TextEncoder().encode(json),
                AtySites.fromBase64(AtySites.PUBLIC_KEY),
            );
            if (!valid) {
                return null;
            }

            const list = JSON.parse(json) as AtySiteList;
            if (list.version !== 1 || !Array.isArray(list.sites) || typeof list.expires !== 'number') {
                return null;
            }

            return { version: list.version, issued: list.issued, expires: list.expires, sites: list.sites };
        } catch {
            return null;
        }
    }

    /**
     * The last verified list, if any.
     *
     * @returns The list, or null.
     */
    protected static async cached(): Promise<AtySiteList | null> {
        try {
            const stored = await CoreConfig.get<string>(AtySites.CACHE_KEY, '');

            return stored ? JSON.parse(stored) as AtySiteList : null;
        } catch {
            return null;
        }
    }

    /**
     * Base64 to bytes.
     *
     * @param base64 The base64 text.
     * @returns The bytes.
     */
    protected static fromBase64(base64: string): Uint8Array {
        return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    }

}

/**
 * The signed list of sites, as the registry serves it.
 */
type AtySiteList = {
    version: number;
    issued: number; // Start of the UTC day it was made, in seconds.
    expires: number; // Thirty days later, in seconds.
    sites: string[]; // SHA-256 hex of each host, sorted.
};
