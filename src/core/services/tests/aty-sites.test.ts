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

import { keygenAsync, signAsync } from '@noble/ed25519';
import { webcrypto } from 'crypto';

import { mockSingleton, overrideTranslations } from '@/testing/utils';
import { CoreConstants } from '@/core/constants';
import { AtySites } from '@services/aty-sites';
import { CoreConfig } from '@services/config';
import { CoreSites } from '@services/sites';
import { CoreSitesFactory } from '@services/sites-factory';
import { CoreCustomURLSchemes } from '@services/urlschemes';
import { CoreWS } from '@services/ws';

/**
 * Oksigenia Aty: the signed list of the sites Oksigenia hosts, and the ways into the app that it guards.
 */
describe('AtySites', () => {

    const DAY = 86400;
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the key the list is checked with, as AtySites names it.
    const sites = AtySites as unknown as { PUBLIC_KEY: string };
    const PUBLIC_KEY = sites.PUBLIC_KEY;

    let keys: { secretKey: Uint8Array; publicKey: Uint8Array };
    let stored: Record<string, unknown>;
    let served: { json: string; signature: string } | null;
    let requests: string[];

    const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
    const now = (): number => Math.floor(Date.now() / 1000);

    /**
     * A list of hosts, as the registry makes it.
     *
     * @param hosts The hosts on it.
     * @param expires When it expires (unix time).
     * @returns The list, as JSON.
     */
    const listOf = async (hosts: string[], expires = now() + 30 * DAY): Promise<string> => JSON.stringify({
        version: 1,
        issued: now() - DAY,
        expires,
        sites: (await Promise.all(hosts.map(host => AtySites.sha256Hex(host)))).sort(),
    });

    /**
     * Serve a list and its signature from the registry.
     *
     * @param json The list.
     * @param secretKey The key that signs it.
     */
    const serve = async (json: string, secretKey = keys.secretKey): Promise<void> => {
        served = { json, signature: base64(await signAsync(new TextEncoder().encode(json), secretKey)) };
    };

    beforeAll(async () => {
        // The phone has Web Crypto; jsdom does not bring its digests, Node's do the same.
        if (!globalThis.crypto?.subtle) {
            Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
        }
        keys = await keygenAsync();
    });

    beforeEach(() => {
        stored = {};
        served = null;
        requests = [];
        sites.PUBLIC_KEY = base64(keys.publicKey);
        CoreConstants.BUILD.isProduction = false;
        overrideTranslations({}, 'en');

        mockSingleton(CoreConfig, {
            get: async (name: string, defaultValue?: unknown) => stored[name] ?? defaultValue,
            set: async (name: string, value: unknown) => {
                stored[name] = value;
            },
            delete: async (name: string) => {
                delete stored[name];
            },
        });
        mockSingleton(CoreWS, {
            sendHTTPRequest: async (url: string) => {
                requests.push(url);
                if (!served) {
                    throw new Error('No connection');
                }

                return { body: url === AtySites.SIGNATURE_URL ? served.signature : served.json };
            },
        });
    });

    afterAll(() => {
        sites.PUBLIC_KEY = PUBLIC_KEY;
        CoreConstants.BUILD.isProduction = false;
    });

    it('opens a site on a list signed by Oksigenia, and keeps the list', async () => {
        await serve(await listOf(['aula.example.com']));

        expect(await AtySites.isAllowed('https://aula.example.com')).toBe(true);
        expect(await AtySites.isAllowed('https://other.example.com')).toBe(false);
        expect(stored['aty_sites_list']).toBeTruthy();
    });

    it('refuses a list with a signature that is not Oksigenia\'s, and does not keep it', async () => {
        const forged = await keygenAsync();
        await serve(await listOf(['aula.example.com']), forged.secretKey);

        await expect(AtySites.assertAllowed('https://aula.example.com')).rejects.toThrow('core.aty.sitecheckfailed');
        expect(stored['aty_sites_list']).toBeUndefined();

        // Nor a list changed after it was signed.
        await serve(await listOf(['aula.example.com']));
        served = { json: await listOf(['aula.example.com', 'intruder.example.com']), signature: served?.signature ?? '' };
        expect(await AtySites.isAllowed('https://intruder.example.com')).toBe(false);
        expect(stored['aty_sites_list']).toBeUndefined();
    });

    it('reads the host in upper case, with a port and with a trailing dot as the same host', async () => {
        await serve(await listOf(['aula.example.com']));

        expect(AtySites.host('https://AULA.Example.com.:8443/moodle')).toEqual('aula.example.com');
        expect(await AtySites.isAllowed('https://AULA.Example.com.:8443/moodle')).toBe(true);
        expect(await AtySites.isAllowed('aula.example.com/moodle/')).toBe(true);
    });

    it('reads an international domain in punycode', async () => {
        await serve(await listOf(['xn--escuela-and-8db4j.example']));

        expect(AtySites.host('https://Escuela-Ñandú.example')).toEqual('xn--escuela-and-8db4j.example');
        expect(await AtySites.isAllowed('https://escuela-ñandú.example')).toBe(true);
    });

    it('asks for a fresh list when the one it keeps has expired, and takes it', async () => {
        stored['aty_sites_list'] = await listOf(['old.example.com'], now() - DAY);
        await serve(await listOf(['new.example.com']));

        expect(await AtySites.isAllowed('https://new.example.com')).toBe(true);
        expect(requests).toContain(AtySites.LIST_URL);
        expect(await AtySites.isAllowed('https://old.example.com')).toBe(false);
    });

    it('trusts the list it keeps when there is no connection, even when it has expired', async () => {
        stored['aty_sites_list'] = await listOf(['aula.example.com'], now() - DAY);

        expect(await AtySites.isAllowed('https://aula.example.com')).toBe(true);
        await expect(AtySites.assertAllowed('https://other.example.com')).rejects.toThrow('core.aty.sitenotallowed');
    });

    it('asks nothing of the registry for a site on the list it keeps, while the list is valid', async () => {
        stored['aty_sites_list'] = await listOf(['aula.example.com']);

        expect(await AtySites.isAllowed('https://aula.example.com')).toBe(true);
        expect(requests).toEqual([]);
    });

    it('says to check the connection, not that the site is not Oksigenia\'s, when it never saw a list', async () => {
        await expect(AtySites.assertAllowed('https://aula.example.com')).rejects.toMatchObject({
            message: 'core.aty.sitecheckfailed',
        });
    });

    it('opens the local demo only in a build that is not for production', async () => {
        expect(await AtySites.isAllowed('http://localhost:8080')).toBe(true);
        expect(await AtySites.isAllowed('http://127.0.0.1')).toBe(true);
        expect(requests).toEqual([]);

        CoreConstants.BUILD.isProduction = true;
        expect(AtySites.isLoopback('http://localhost:8080')).toBe(false);
        await expect(AtySites.assertAllowed('http://localhost:8080')).rejects.toThrow('core.aty.sitecheckfailed');

        await serve(await listOf(['aula.example.com']));
        await expect(AtySites.assertAllowed('http://localhost:8080')).rejects.toThrow('core.aty.sitenotallowed');
    });

    it('never checks a site over http with the list in force', async () => {
        stored['aty_sites_list'] = await listOf(['aula.example.com']);
        const checked: string[] = [];
        mockSingleton(CoreSites, {
            checkSiteWithProtocol: async (siteUrl: string, protocol: string) => {
                checked.push(siteUrl.replace(/^https?:\/\//i, protocol));

                throw new Error('Cannot connect');
            },
        });

        await expect(CoreSites.checkSite('http://aula.example.com', 'http://')).rejects.toThrow('Cannot connect');
        await expect(CoreSites.checkSite('aula.example.com')).rejects.toThrow('Cannot connect');

        expect(checked).toEqual(['https://aula.example.com', 'https://aula.example.com']);
    });

    it('does not let an old link with a token bring in a site that is not on the list', async () => {
        stored['aty_sites_list'] = await listOf(['aula.example.com']);
        const newSite = jest.spyOn(CoreSites, 'newSite');
        const makeSite = jest.spyOn(CoreSitesFactory, 'makeAuthenticatedSite');

        await expect(CoreCustomURLSchemes.handleCustomURL('oksigeniaaty://https://ajeno.example?token=X')).rejects
            .toMatchObject({ error: 'core.errorurlschemeinvalidsite' });
        expect(newSite).not.toHaveBeenCalled();

        // And newSite itself stops it, before asking the site anything.
        await expect(CoreSites.newSite('https://ajeno.example', 'X')).rejects.toThrow('core.aty.sitenotallowed');
        expect(newSite).toHaveBeenCalledTimes(1);
        expect(makeSite).not.toHaveBeenCalled();
    });

});
