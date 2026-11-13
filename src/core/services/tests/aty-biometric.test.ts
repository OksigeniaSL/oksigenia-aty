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
import { CoreSite } from '@classes/sites/site';
import { CoreCanceledError } from '@classes/errors/cancelederror';
import { AtyBiometric } from '@services/aty-biometric';
import { AtyBiometricMenuHandler } from '@services/aty-biometric-menu';
import { AtyRenewal } from '@services/aty-renewal';
import { CoreConfig } from '@services/config';
import { CoreAlerts } from '@services/overlays/alerts';
import { CoreModals } from '@services/overlays/modals';
import { CoreToasts } from '@services/overlays/toasts';
import { CoreSites } from '@services/sites';
import { CoreEvents } from '@static/events';

/**
 * Oksigenia Aty: the PIN behind the fingerprint or face belongs to one account (site and user), not to a site.
 */
describe('AtyBiometric', () => {

    const siteUrl = 'https://aula.example.com';
    const ana = { id: 'aula-ana', siteUrl, fullname: 'Ana Pérez', pin: '1111' };
    const luis = { id: 'aula-luis', siteUrl, fullname: 'Luis Gil', pin: '2222' };

    let stored: Record<string, unknown>;
    let accounts: typeof ana[];
    let secret: string | undefined;
    let plugin: {
        isAvailable: jest.Mock;
        registerBiometricSecret: jest.Mock;
        loadBiometricSecret: jest.Mock;
    };
    let openModal: jest.Mock;
    let confirm: jest.Mock;

    const renewal = AtyRenewal as unknown as { renew(site: CoreSite): Promise<void> };
    const menu = AtyBiometricMenuHandler as unknown as { toggle(): Promise<void> };

    /**
     * An account's site, with the renewal web service of local_oksigeniaaty.
     *
     * @param account The account.
     * @returns The site, and the PINs it was sent.
     */
    const siteOf = (account: typeof ana): { site: CoreSite; pins: string[] } => {
        const pins: string[] = [];
        const site = {
            getId: () => account.id,
            getURL: () => account.siteUrl,
            write: async (_fn: string, { pin }: { pin: string }) => {
                pins.push(pin);

                return pin === account.pin
                    ? { needspin: false, validuntil: Math.floor(Date.now() / 1000) + 90 * 86400 }
                    : {
                        needspin: true,
                        error: pin ? 'Wrong PIN' : '',
                        title: 'PIN',
                        ok: 'OK',
                        cancel: 'Cancel',
                        biometric: 'Touch',
                    };
            },
        } as unknown as CoreSite;

        return { site, pins };
    };

    /**
     * Turn it on for an account, as the menu leaves it.
     *
     * @param account The account.
     */
    const enrol = async (account: typeof ana): Promise<void> => {
        expect(await AtyBiometric.enable(account.id, account.pin, 'Touch')).toBe(true);
    };

    beforeEach(() => {
        stored = {};
        accounts = [ana, luis];
        secret = undefined;
        overrideTranslations({
            'core.aty.biometricaskenable': 'Use it?',
            'core.aty.biometriconeaccount': 'Only one account: {{name}} at {{site}} goes back to the PIN.',
        }, 'en');

        plugin = {
            isAvailable: jest.fn((success: (type: string) => void) => success('finger')),
            registerBiometricSecret: jest.fn((options: { secret: string }, success: () => void) => {
                secret = options.secret;
                success();
            }),
            loadBiometricSecret: jest.fn((_options: unknown, success: (secret: string) => void, error: (e: unknown) => void) =>
                secret === undefined ? error(-113) : success(secret)),
        };
        // eslint-disable-next-line @typescript-eslint/naming-convention -- the plugin's global is named Fingerprint.
        (window as unknown as { Fingerprint?: unknown }).Fingerprint = plugin;

        mockSingleton(CoreConfig, {
            get: async (name: string, defaultValue?: unknown) => stored[name] ?? defaultValue,
            set: async (name: string, value: unknown) => {
                stored[name] = value;
            },
            delete: async (name: string) => {
                delete stored[name];
            },
        });
        mockSingleton(CoreSites, {
            getSites: async (ids?: string[]) => accounts.filter(account => !ids || ids.includes(account.id)),
        });
        openModal = jest.fn(async () => undefined);
        mockSingleton(CoreModals, { openModal });
        confirm = jest.fn(async () => undefined);
        mockSingleton(CoreAlerts, { confirm, showError: async () => undefined, show: async () => undefined });
        mockSingleton(CoreToasts, { show: async () => undefined });
    });

    afterAll(() => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- the plugin's global is named Fingerprint.
        delete (window as unknown as { Fingerprint?: unknown }).Fingerprint;
    });

    it('keeps the PIN for the account that turned it on, not for the other account of its site', async () => {
        await enrol(ana);

        expect(await AtyBiometric.isEnrolled(ana.id)).toBe(true);
        expect(await AtyBiometric.isEnrolled(luis.id)).toBe(false);
        expect(await AtyBiometric.unlockPin(luis.id, 'Touch')).toBeUndefined();
        expect(plugin.loadBiometricSecret).not.toHaveBeenCalled();
        expect(await AtyBiometric.unlockPin(ana.id, 'Touch')).toEqual(ana.pin);
    });

    it('is forgotten only by its own account', async () => {
        await enrol(ana);

        await AtyBiometric.forget(luis.id);
        expect(await AtyBiometric.isEnrolled(ana.id)).toBe(true);

        await AtyBiometric.forget(ana.id);
        expect(await AtyBiometric.enrolledAccount()).toEqual('');
    });

    it('passes to the account that turns it on last: the phone keeps one', async () => {
        await enrol(ana);
        await enrol(luis);

        expect(await AtyBiometric.isEnrolled(ana.id)).toBe(false);
        expect(await AtyBiometric.unlockPin(luis.id, 'Touch')).toEqual(luis.pin);
    });

    it('moves what was kept by site URL to the one account of that site, with nothing to turn on again', async () => {
        accounts = [ana, { ...luis, id: 'other-luis', siteUrl: 'https://other.example.com' }];
        stored['aty_biometric_site'] = siteUrl;
        secret = ana.pin;

        expect(await AtyBiometric.enrolledAccount()).toEqual(ana.id);
        expect(stored['aty_biometric_site']).toBeUndefined();
        expect(await AtyBiometric.unlockPin(ana.id, 'Touch')).toEqual(ana.pin);
    });

    it('turns it off when it was kept by site URL and nobody can tell which account of the site turned it on', async () => {
        stored['aty_biometric_site'] = siteUrl;
        secret = ana.pin;

        expect(await AtyBiometric.enrolledAccount()).toEqual('');
        expect(stored['aty_biometric_site']).toBeUndefined();
        expect(await AtyBiometric.unlockPin(luis.id, 'Touch')).toBeUndefined();

        stored['aty_biometric_site'] = 'https://gone.example.com';
        expect(await AtyBiometric.enrolledAccount()).toEqual('');
    });

    it('renews the other account of the site with its own PIN pad, never with the PIN of the first', async () => {
        await enrol(ana);
        const { site, pins } = siteOf(luis);

        await renewal.renew(site);

        expect(pins).toEqual(['']);
        expect(plugin.loadBiometricSecret).not.toHaveBeenCalled();
        expect(openModal).toHaveBeenCalledTimes(1);
        expect(await AtyBiometric.isEnrolled(ana.id)).toBe(true);
    });

    it('renews with a touch, and forgets a PIN the site refuses instead of trying it on every renewal', async () => {
        await enrol(ana);
        const { site, pins } = siteOf(ana);

        await renewal.renew(site);
        expect(pins).toEqual(['', ana.pin]);
        expect(openModal).not.toHaveBeenCalled();

        // The PIN changed on the site.
        ana.pin = '9999';
        try {
            pins.length = 0;
            await renewal.renew(site);
            expect(pins).toEqual(['', '1111']);
            expect(openModal).toHaveBeenCalledTimes(1);
            expect(await AtyBiometric.enrolledAccount()).toEqual('');

            pins.length = 0;
            await renewal.renew(site);
            expect(pins).toEqual(['']);
            expect(plugin.loadBiometricSecret).toHaveBeenCalledTimes(2);
        } finally {
            ana.pin = '1111';
        }
    });

    it('is forgotten when its account leaves the phone, and not when another one does', async () => {
        AtyRenewal.initialize();
        await enrol(ana);

        CoreEvents.trigger(CoreEvents.SITE_DELETED, {} as CoreSite, luis.id);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(await AtyBiometric.isEnrolled(ana.id)).toBe(true);

        CoreEvents.trigger(CoreEvents.SITE_DELETED, {} as CoreSite, ana.id);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(await AtyBiometric.enrolledAccount()).toEqual('');
    });

    it('shows it off in the menu of the other account of the site, which cannot turn off the first one\'s', async () => {
        await enrol(ana);
        const { site } = siteOf(luis);
        mockSingleton(CoreSites, {
            getCurrentSite: () => site,
            getSites: async (ids?: string[]) => accounts.filter(account => !ids || ids.includes(account.id)),
        });
        confirm.mockRejectedValueOnce(new CoreCanceledError());

        await menu.toggle();

        // It offers to turn it on, and says whose it is now.
        expect(confirm).toHaveBeenCalledWith(
            'Use it? Only one account: Ana Pérez at aula.example.com goes back to the PIN.',
            expect.anything(),
        );
        expect(await AtyBiometric.isEnrolled(ana.id)).toBe(true);
    });

    it('turns it on in the menu for the account in use, with its own checked PIN', async () => {
        await enrol(ana);
        const { site, pins } = siteOf(luis);
        mockSingleton(CoreSites, {
            getCurrentSite: () => site,
            getSites: async (ids?: string[]) => accounts.filter(account => !ids || ids.includes(account.id)),
        });
        openModal.mockImplementation(async (options: { componentProps: { validator(pin: string): Promise<unknown> } }) => {
            await options.componentProps.validator(luis.pin);
        });

        await menu.toggle();

        expect(pins).toEqual(['', luis.pin]);
        expect(await AtyBiometric.enrolledAccount()).toEqual(luis.id);
        expect(secret).toEqual(luis.pin);
    });

    it('turns it off in the menu of its own account', async () => {
        await enrol(ana);
        const { site } = siteOf(ana);
        mockSingleton(CoreSites, { getCurrentSite: () => site });

        await menu.toggle();

        expect(confirm).toHaveBeenCalledWith('core.aty.biometricaskdisable', expect.anything());
        expect(await AtyBiometric.enrolledAccount()).toEqual('');
    });

});
