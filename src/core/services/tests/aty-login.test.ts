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

import { mockSingleton, overrideTranslations } from '@/testing/utils';
import { CoreCanceledError } from '@classes/errors/cancelederror';
import { CorePromisedValue } from '@classes/promised-value';
import { AtyLogin, AtyTokenResponse } from '@services/aty-login';
import { AtySites } from '@services/aty-sites';
import { CoreConfig } from '@services/config';
import { CoreAlerts } from '@services/overlays/alerts';
import { CoreLoadings } from '@services/overlays/loadings';
import { CoreModals } from '@services/overlays/modals';
import { CoreSites } from '@services/sites';
import { CoreWS } from '@services/ws';
import { CoreSSO } from '@static/sso';

/**
 * Oksigenia Aty: the sign-in links (oksigeniaaty://atylogin=…), the question before entering someone else's account and
 * the lock that redeems each link once.
 */
describe('AtyLogin', () => {

    const siteUrl = 'https://aula.example.com';

    let stored: Record<string, unknown>;
    let accounts: { id: string; siteUrl: string; username: string }[];
    let answers: (data: { key: string; pin?: string }) => AtyTokenResponse;
    let confirm: jest.Mock;

    /**
     * A sign-in link, as the site's «Open in the app» page makes it.
     *
     * @param key The one-time key.
     * @returns The link.
     */
    const linkOf = (key: string): string =>
        `oksigeniaaty://atylogin=${btoa(`${siteUrl}:::${key}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

    beforeEach(() => {
        stored = {};
        accounts = [];
        answers = () => ({ token: 'token', username: 'ana', fullname: 'Ana Pérez' });
        confirm = jest.fn(async () => undefined);
        overrideTranslations({ 'core.aty.switchaccount': 'This link signs in {{name}} at {{site}}. Is that you?' }, 'en');
        CoreSSO.finishSSOAuthentication();

        jest.spyOn(AtySites, 'assertAllowed').mockResolvedValue();
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
            sendHTTPRequest: async (_url: string, options: { data: { key: string; pin?: string } }) =>
                ({ body: answers(options.data) }),
        });
        mockSingleton(CoreSites, {
            getSites: async () => accounts.map(({ id, siteUrl }) => ({ id, siteUrl })),
            getSite: async (id: string) => {
                const account = accounts.find(account => account.id === id);
                if (!account) {
                    throw new Error('No site');
                }

                return { getInfo: () => ({ username: account.username }) };
            },
        });
        mockSingleton(CoreAlerts, { confirm });
        mockSingleton(CoreLoadings, { pauseActiveModals: async () => undefined, resumeActiveModals: async () => undefined });
    });

    it('knows whether the phone holds an account, by site and username', async () => {
        expect(await AtyLogin.holdsAccount(siteUrl, 'ana')).toBe(true); // No account at all: nothing to switch from.

        accounts = [{ id: 'a', siteUrl: 'https://AULA.example.com/', username: 'ana' }];
        expect(await AtyLogin.holdsAccount(siteUrl, 'ana')).toBe(true);
        expect(await AtyLogin.holdsAccount(siteUrl, 'luis')).toBe(false);
        expect(await AtyLogin.holdsAccount('https://other.example.com', 'ana')).toBe(false);
    });

    it('signs in the first account of the phone without asking', async () => {
        const data = await AtyLogin.getLoginData(linkOf('KEY1'));

        expect(data).toMatchObject({ siteUrl, token: 'token', isSSOToken: true });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('signs in an account the phone holds without asking', async () => {
        accounts = [{ id: 'a', siteUrl, username: 'ana' }];

        await AtyLogin.getLoginData(linkOf('KEY2'));

        expect(confirm).not.toHaveBeenCalled();
    });

    it('asks before signing in someone else\'s account, and stops if it is not you', async () => {
        accounts = [{ id: 'b', siteUrl, username: 'luis' }];
        confirm.mockRejectedValueOnce(new CoreCanceledError());

        await expect(AtyLogin.getLoginData(linkOf('KEY3'))).rejects.toMatchObject({ error: expect.any(CoreCanceledError) });
        expect(confirm).toHaveBeenCalledWith('This link signs in Ana Pérez at aula.example.com. Is that you?', expect.anything());
        expect(CoreSSO.isSSOAuthenticationOngoing()).toBe(false);

        // Yes, it is you.
        const data = await AtyLogin.getLoginData(linkOf('KEY4'));
        expect(data.token).toEqual('token');
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('redeems a link once while its PIN is typed, however long it takes', async () => {
        answers = (data) => data.pin === '2468' ? { token: 'token', username: 'ana' } : { needspin: true, pinui: {} };
        const closed = new CorePromisedValue<string>();
        let validator: ((pin: string) => Promise<{ ok: boolean }>) | undefined;
        const openModal = jest.fn(async (options: { componentProps: { validator: typeof validator } }) => {
            validator = options.componentProps.validator;

            return closed;
        });
        mockSingleton(CoreModals, { openModal });

        const first = AtyLogin.getLoginData(linkOf('KEY5'));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(openModal).toHaveBeenCalledTimes(1);

        // CoreSSO's mark lets go after 10 seconds; Android hands the link over again.
        CoreSSO.finishSSOAuthentication();
        await expect(AtyLogin.getLoginData(linkOf('KEY5'))).rejects.toMatchObject({ error: 'Duplicated' });
        expect(openModal).toHaveBeenCalledTimes(1);

        expect(await validator?.('2468')).toEqual({ ok: true, message: undefined });
        closed.resolve('2468');
        expect((await first).token).toEqual('token');

        // Once used, the link is spent (the sign-in finishes CoreSSO's mark, as handleCustomURL does).
        CoreSSO.finishSSOAuthentication();
        await expect(AtyLogin.getLoginData(linkOf('KEY5'))).rejects.toMatchObject({ error: 'Duplicated' });
    });

    it('lets go of a link whose PIN pad was put away, so it can be opened again', async () => {
        answers = () => ({ needspin: true, pinui: {} });
        const openModal = jest.fn(async () => undefined);
        mockSingleton(CoreModals, { openModal });

        await expect(AtyLogin.getLoginData(linkOf('KEY6'))).rejects.toMatchObject({ error: expect.any(CoreCanceledError) });
        await expect(AtyLogin.getLoginData(linkOf('KEY6'))).rejects.toMatchObject({ error: expect.any(CoreCanceledError) });

        expect(openModal).toHaveBeenCalledTimes(2);
    });

});
