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

import { CoreConfig } from '@services/config';
import { CoreSites } from '@services/sites';

/**
 * Biometric unlock for Oksigenia Aty: store the sign-in PIN behind the device's fingerprint or face (in the Android
 * keystore, via cordova-plugin-fingerprint-aio) so renewing or signing in can be a touch instead of typing. The PIN
 * never leaves the device except as the normal sign-in call; biometrics only unlock the stored copy.
 *
 * The plugin keeps one secret per device, so one account at a time holds it: the account (site and user, the app's
 * site id) that turned it on last. Other accounts, also of the same site, use the PIN pad.
 */
export class AtyBiometric {

    /** Which account (site id) the stored biometric PIN belongs to. */
    protected static readonly ACCOUNT_KEY = 'aty_biometric_account';

    /** Where it was kept until November 2026: by site URL, which two accounts of one site share. */
    protected static readonly LEGACY_SITE_KEY = 'aty_biometric_site';

    /**
     * Whether the device has biometric hardware enrolled and the plugin is present (false on the web).
     *
     * @returns Whether biometrics can be used.
     */
    static async isAvailable(): Promise<boolean> {
        const plugin = AtyBiometric.plugin();
        if (!plugin) {
            return false;
        }

        return new Promise(resolve => plugin.isAvailable(() => resolve(true), () => resolve(false)));
    }

    /**
     * The account whose PIN is stored behind biometrics, or empty when none is.
     *
     * @returns The site id of the account, or ''.
     */
    static async enrolledAccount(): Promise<string> {
        try {
            const account = await CoreConfig.get<string>(AtyBiometric.ACCOUNT_KEY, '');

            return account || await AtyBiometric.migrate();
        } catch {
            return '';
        }
    }

    /**
     * Whether an account's PIN is the one stored behind biometrics.
     *
     * @param siteId The site id of the account.
     * @returns Whether it is.
     */
    static async isEnrolled(siteId: string): Promise<boolean> {
        return !!siteId && (await AtyBiometric.enrolledAccount()) === siteId;
    }

    /**
     * Store an account's PIN behind biometrics, in place of any other account's.
     *
     * @param siteId The site id of the account the PIN belongs to.
     * @param pin The PIN to store.
     * @param description The prompt the OS shows.
     * @returns Whether it was stored.
     */
    static async enable(siteId: string, pin: string, description: string): Promise<boolean> {
        const plugin = AtyBiometric.plugin();
        if (!plugin) {
            return false;
        }

        return new Promise(resolve => {
            plugin.registerBiometricSecret(
                { description, secret: pin, invalidateOnEnrollment: true },
                async () => {
                    try {
                        await CoreConfig.set(AtyBiometric.ACCOUNT_KEY, siteId);
                        await CoreConfig.delete(AtyBiometric.LEGACY_SITE_KEY);
                    } catch {
                        // Ignore storage errors; biometrics simply will not be offered next time.
                    }
                    resolve(true);
                },
                () => resolve(false),
            );
        });
    }

    /**
     * Unlock an account's stored PIN with biometrics. Nothing is asked when the stored PIN belongs to another account.
     *
     * @param siteId The site id of the account.
     * @param description The prompt the OS shows.
     * @returns The PIN, or undefined when it is not this account's, the user cancels or it fails.
     */
    static async unlockPin(siteId: string, description: string): Promise<string | undefined> {
        const plugin = AtyBiometric.plugin();
        if (!plugin || !(await AtyBiometric.isEnrolled(siteId))) {
            return undefined;
        }

        return new Promise(resolve => {
            plugin.loadBiometricSecret({ description }, secret => resolve(secret || undefined), () => resolve(undefined));
        });
    }

    /**
     * Forget the stored biometric PIN, if it is the account's: the menu turns it off, the account leaves the phone or its site
     * refuses the PIN. The plugin can only overwrite its copy, behind the fingerprint or face, which the next account to turn
     * it on does; until then nothing in the app unlocks it.
     *
     * @param siteId The site id of the account.
     */
    static async forget(siteId: string): Promise<void> {
        if (!(await AtyBiometric.isEnrolled(siteId))) {
            return;
        }

        try {
            await CoreConfig.delete(AtyBiometric.ACCOUNT_KEY);
        } catch {
            // Ignore.
        }
    }

    /**
     * Move what was kept by site URL to the account that turned it on, so nobody has to turn it on again. With one account
     * of that site on the phone, it is that one; with none or with several, nobody can tell, and it is turned off: the PIN
     * of one must never be tried for another, which would also count against the other's lock.
     *
     * @returns The account it now belongs to, or ''.
     */
    protected static async migrate(): Promise<string> {
        const siteUrl = await CoreConfig.get<string>(AtyBiometric.LEGACY_SITE_KEY, '');
        if (!siteUrl) {
            return '';
        }

        const trim = (url: string): string => url.replace(/\/+$/, '');
        const owners = (await CoreSites.getSites()).filter(site => trim(site.siteUrl) === trim(siteUrl));
        const account = owners.length === 1 ? owners[0].id : '';

        if (account) {
            await CoreConfig.set(AtyBiometric.ACCOUNT_KEY, account);
        }
        await CoreConfig.delete(AtyBiometric.LEGACY_SITE_KEY);

        return account;
    }

    /**
     * The cordova-plugin-fingerprint-aio global, or undefined (web, or before the device is ready).
     *
     * @returns The plugin, or undefined.
     */
    protected static plugin(): AtyFingerprintPlugin | undefined {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- the plugin's global is named Fingerprint.
        return (window as unknown as { Fingerprint?: AtyFingerprintPlugin }).Fingerprint;
    }

}

/**
 * The slice of cordova-plugin-fingerprint-aio this uses (one secret per device, Android keystore or iOS keychain).
 */
interface AtyFingerprintPlugin {
    isAvailable(success: (type: string) => void, error: (err: unknown) => void): void;
    registerBiometricSecret(
        options: { description?: string; secret: string; invalidateOnEnrollment?: boolean; disableBackup?: boolean },
        success: () => void,
        error: (err: unknown) => void,
    ): void;
    loadBiometricSecret(
        options: { description?: string; disableBackup?: boolean },
        success: (secret: string) => void,
        error: (err: unknown) => void,
    ): void;
}
