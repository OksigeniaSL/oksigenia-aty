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

import { mockSingleton } from '@/testing/utils';
import { CoreConfig } from '@services/config';
import { Md5 } from 'ts-md5';
import { CoreLoginHelper } from '../services/login-helper';

describe('Browser login', () => {

    const siteUrl = 'https://school.example';
    let stored: Record<string, unknown>;

    /**
     * What the site sends back to the app for a login.
     *
     * @param loginUrl The URL that login opened.
     * @param site Site URL the signature is made with.
     * @returns The app's URL payload.
     */
    const returnOf = (loginUrl: string, site = siteUrl): string =>
        `${Md5.hashAsciiStr(site + new URL(loginUrl).searchParams.get('passport'))}:::token:::private`;

    beforeEach(() => {
        stored = {};
        mockSingleton(CoreConfig, {
            get: async (name: string, defaultValue?: unknown) => stored[name] ?? defaultValue,
            set: async (name: string, value: unknown) => {
                stored[name] = value;
            },
            delete: async (name: string) => {
                delete stored[name];
            },
        });
    });

    it('signs in with the return of the only login', async () => {
        const url = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');

        const data = await CoreLoginHelper.validateBrowserSSOLogin(returnOf(url));

        expect(data.siteUrl).toEqual(siteUrl);
        expect(data.token).toEqual('token');
        expect(data.privateToken).toEqual('private');
    });

    it('signs in with the return of an earlier login, after a second tap', async () => {
        const first = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');
        await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');

        const data = await CoreLoginHelper.validateBrowserSSOLogin(returnOf(first));

        expect(data.token).toEqual('token');
    });

    it('also signs in with the return of the last login, and with the other protocol', async () => {
        await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');
        const last = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');

        const data = await CoreLoginHelper.validateBrowserSSOLogin(returnOf(last, siteUrl.replace('https', 'http')));

        expect(data.siteUrl).toEqual(siteUrl.replace('https', 'http'));
    });

    it('refuses a return it does not know, and the login under way still works', async () => {
        const url = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');

        await expect(CoreLoginHelper.validateBrowserSSOLogin('badsignature:::token:::private')).rejects.toThrow();

        await expect(CoreLoginHelper.validateBrowserSSOLogin(returnOf(url))).resolves.toBeTruthy();
    });

    it('forgets every login once one has come back', async () => {
        const first = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');
        const last = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');

        await CoreLoginHelper.validateBrowserSSOLogin(returnOf(last));

        await expect(CoreLoginHelper.validateBrowserSSOLogin(returnOf(first))).rejects.toThrow();
    });

    it('does not keep logins that are too old or to another site', async () => {
        const now = Date.now();
        const old = await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');
        const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 31 * 60 * 1000);
        await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');
        spy.mockRestore();
        await expect(CoreLoginHelper.validateBrowserSSOLogin(returnOf(old))).rejects.toThrow();

        const other = await CoreLoginHelper.prepareForSSOLogin('https://other.example', 'service');
        await CoreLoginHelper.prepareForSSOLogin(siteUrl, 'service');
        await expect(CoreLoginHelper.validateBrowserSSOLogin(returnOf(other, 'https://other.example'))).rejects.toThrow();
    });

});
