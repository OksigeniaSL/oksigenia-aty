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

/**
 * Biometric unlock for Oksigenia Aty: store the sign-in PIN behind the device's fingerprint or face (in the Android
 * keystore, via cordova-plugin-fingerprint-aio) so renewing or signing in can be a touch instead of typing. The PIN
 * never leaves the device except as the normal sign-in call; biometrics only unlock the stored copy.
 *
 * One secret per device (the common case: one person's phone), tied to the site it was set up for; other sites still
 * use the PIN pad.
 */
export class AtyBiometric {

    /** Which site the stored biometric PIN belongs to. */
    protected static readonly SITE_KEY = 'aty_biometric_site';

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
     * The site whose PIN is stored behind biometrics, or empty when none is.
     *
     * @returns The site URL, or ''.
     */
    static async enrolledSite(): Promise<string> {
        try {
            return await CoreConfig.get<string>(AtyBiometric.SITE_KEY, '');
        } catch {
            return '';
        }
    }

    /**
     * Store a site's PIN behind biometrics.
     *
     * @param siteUrl The site the PIN belongs to.
     * @param pin The PIN to store.
     * @param description The prompt the OS shows.
     * @returns Whether it was stored.
     */
    static async enable(siteUrl: string, pin: string, description: string): Promise<boolean> {
        const plugin = AtyBiometric.plugin();
        if (!plugin) {
            return false;
        }

        return new Promise(resolve => {
            plugin.registerBiometricSecret(
                { description, secret: pin, invalidateOnEnrollment: true },
                async () => {
                    try {
                        await CoreConfig.set(AtyBiometric.SITE_KEY, siteUrl);
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
     * Unlock the stored PIN with biometrics.
     *
     * @param description The prompt the OS shows.
     * @returns The PIN, or undefined when the user cancels or it fails.
     */
    static async unlockPin(description: string): Promise<string | undefined> {
        const plugin = AtyBiometric.plugin();
        if (!plugin) {
            return undefined;
        }

        return new Promise(resolve => {
            plugin.loadBiometricSecret({ description }, secret => resolve(secret || undefined), () => resolve(undefined));
        });
    }

    /**
     * Forget the stored biometric PIN.
     */
    static async disable(): Promise<void> {
        try {
            await CoreConfig.delete(AtyBiometric.SITE_KEY);
        } catch {
            // Ignore.
        }
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
 * The slice of cordova-plugin-fingerprint-aio this uses (secret storage is Android only).
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
