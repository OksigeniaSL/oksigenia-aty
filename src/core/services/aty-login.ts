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

import { Injectable } from '@angular/core';

import { CoreError } from '@classes/errors/error';
import { CoreCanceledError } from '@classes/errors/cancelederror';
import { CoreErrorHelper } from '@services/error-helper';
import { CoreLang } from '@services/lang';
import { CoreAlerts } from '@services/overlays/alerts';
import { CoreLoadings } from '@services/overlays/loadings';
import { CoreModals } from '@services/overlays/modals';
import { CoreCustomURLSchemesHandleError, CoreCustomURLSchemesParams } from '@services/urlschemes';
import { CoreWS, HttpRequestOptions } from '@services/ws';
import { Translate, makeSingleton } from '@singletons';
import { CoreLogger } from '@static/logger';
import { CoreSSO } from '@static/sso';

import { CoreConstants } from '../constants';

/**
 * What local/oksigeniaaty/token.php answers when the app exchanges a one-time key.
 */
export type AtyTokenResponse = {
    token?: string;
    privatetoken?: string;
    siteurl?: string;
    lang?: string;
    validuntil?: number; // When the token expires (unix time, 0 = never), so the app can renew it in time.
    needspin?: boolean; // The user has a PIN set and it was missing or wrong; the key was not consumed.
    needspinsetup?: boolean; // Signed in, but no PIN yet: offer to set one (trust on first use).
    locked?: boolean; // Too many wrong PINs; verification is temporarily locked.
    pinui?: AtyPinUi; // Localised wording for the PIN pad (the server knows the user's language).
    error?: string; // Localised error (wrong PIN, locked, or a generic failure).
};

/**
 * The localised wording for the PIN pad, as token.php returns it.
 */
export type AtyPinUi = {
    title?: string;
    message?: string;
    ok?: string;
    cancel?: string;
    forgot?: string;
    biometric?: string;
    biometricask?: string;
};

/**
 * Oksigenia Aty passwordless sign-in: everything the custom URL scheme handler needs for an "atylogin" link, kept in
 * its own service so the only Aty change to the core urlschemes file is a short dispatch that lazily loads this.
 */
@Injectable({ providedIn: 'root' })
export class AtyLoginService {

    protected logger = CoreLogger.getInstance('AtyLogin');

    /**
     * Check whether a URL is an Oksigenia Aty sign-in URL (scheme://atylogin=...).
     *
     * @param url URL to check.
     * @returns Whether it's an Aty sign-in URL.
     */
    isAtyLoginUrl(url: string): boolean {
        if (!url) {
            return false;
        }

        return url.includes(`${CoreConstants.CONFIG.customurlscheme}://atylogin=`);
    }

    /**
     * Turn an Aty magic link (https://.../local/oksigeniaaty/open.php?key=...) into the app's sign-in scheme, so a QR
     * or link that any camera can open also signs in when scanned with the app itself. Returns undefined otherwise.
     *
     * @param url The scanned or opened URL.
     * @returns The sign-in scheme URL, or undefined.
     */
    getSchemeFromMagicLink(url: string): string | undefined {
        if (!url) {
            return undefined;
        }

        const match = url.match(/^(https:\/\/.+?)\/local\/oksigeniaaty\/open\.php(?:\?|$)/i);
        if (!match) {
            return undefined;
        }

        const siteUrl = match[1];
        const query = url.includes('?') ? url.substring(url.indexOf('?') + 1) : '';
        const key = new URLSearchParams(query).get('key');
        if (!key || !/^[a-zA-Z0-9]+$/.test(key)) {
            return undefined;
        }

        const payload = btoa(`${siteUrl}:::${key}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        return `${CoreConstants.CONFIG.customurlscheme}://atylogin=${payload}`;
    }

    /**
     * Get the data needed to sign in from an Oksigenia Aty sign-in URL.
     *
     * The URL carries base64("siteurl:::key"); the one-time key is exchanged for an app token at the site's
     * local/oksigeniaaty/token.php, so no password is needed. Returns SSO-style data for the normal site creation flow.
     *
     * @param url The sign-in URL.
     * @returns The sign-in data.
     */
    async getLoginData(url: string): Promise<CoreCustomURLSchemesParams> {
        if (!this.isAtyLoginUrl(url)) {
            throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite')));
        }

        if (CoreSSO.isSSOAuthenticationOngoing()) {
            throw new CoreCustomURLSchemesHandleError('Duplicated');
        }

        CoreSSO.startSSOAuthentication();
        this.logger.debug('App launched by an Aty sign-in URL');

        // Once SSO is started, finish it on any failure so a cancelled or failed sign-in does not leave it stuck
        // "ongoing" (on success, handleCustomURL finishes it for us because isSSOToken is set).
        try {
            let payload = url.replace(`${CoreConstants.CONFIG.customurlscheme}://atylogin=`, '');
            payload = payload.replace(/\/?#?\/?$/, '');

            let decoded: string;
            try {
                // Accept standard base64 and base64url, padded or not.
                let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
                while (base64.length % 4) {
                    base64 += '=';
                }
                decoded = atob(base64);
            } catch {
                throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite')));
            }

            const parts = decoded.split(':::');
            const siteUrl = parts[0];
            const key = parts[1];
            // Only ever sign in to an https site from a sign-in link; never cleartext.
            if (!siteUrl || !key || !/^https:\/\//i.test(siteUrl)) {
                throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite')));
            }

            const tokenUrl = `${siteUrl}/local/oksigeniaaty/token.php`;

            // Exchange the key for a token. If the user has set a PIN, the server asks for it without consuming the
            // key, so we can prompt and retry until it is right (or the user cancels). All of the pad's wording is
            // localised by the server (it knows the user's language), so the app ships no PIN strings of its own.
            let response = await this.postKey(tokenUrl, { key });
            if (response?.needspin) {
                // The pad checks each PIN against the server and only closes on success; a wrong PIN shakes it in place.
                let signedIn: AtyTokenResponse | null = null;
                const outcome = await this.promptPin(response.pinui ?? {}, async (candidate) => {
                    const attempt = await this.postKey(tokenUrl, { key, pin: candidate });
                    signedIn = attempt;

                    return { ok: !!attempt?.token, message: attempt?.error };
                });

                if (outcome.forgot) {
                    // Send the user to the PIN recovery page, and abort this sign-in. Imported lazily to avoid a cycle.
                    const { CoreOpener } = await import('@static/opener');
                    CoreOpener.openInApp(`${siteUrl}/local/oksigeniaaty/forgotpin.php`);

                    throw new CoreCustomURLSchemesHandleError(new CoreCanceledError());
                }
                if (outcome.pin === undefined) {
                    // The user dismissed the PIN pad.
                    throw new CoreCustomURLSchemesHandleError(new CoreCanceledError());
                }

                response = signedIn;
            }

            if (!response || !response.token) {
                // The server localises its own failure (expired or used link, mobile access off, ...); show that
                // message when we have it, so the user reads why, and fall back to a generic one otherwise.
                const message = response?.error || Translate.instant('core.login.invalidaccount');
                throw new CoreCustomURLSchemesHandleError(new CoreError(message));
            }

            // Trust on first use: no PIN yet, so offer to set one for next time (the user may skip it).
            if (response.needspinsetup && response.pinui) {
                await this.offerPinSetup(siteUrl, response.token, response.pinui);
            }

            // Dress the app in the user's own language: open a link, land in your language.
            if (response.lang) {
                try {
                    await CoreLang.changeCurrentLanguage(response.lang);
                } catch {
                    // Keep the current language when the user's one is not available in the app.
                }
            }

            // Remember the token's expiry so the app can renew it with the PIN before it falls. Imported lazily so this
            // service does not statically depend on the renewal service (which would add an import cycle).
            const { AtyRenewal } = await import('@services/aty-renewal');
            AtyRenewal.rememberValidUntil(siteUrl, response.validuntil ?? 0);

            return {
                // The site from the link, never one the server claims.
                siteUrl,
                token: response.token,
                privateToken: response.privatetoken,
                isSSOToken: true,
                isAuthenticationURL: true,
            };
        } catch (error) {
            CoreSSO.finishSSOAuthentication();

            throw error;
        }
    }

    /**
     * POST a one-time key (and an optional PIN) to the site's token.php and return its parsed answer.
     *
     * Uses the native HTTP so it bypasses CORS; the key travels in the POST body, out of logs and the URL.
     *
     * @param tokenUrl The site's token.php URL.
     * @param data The key, and the PIN when the user is supplying one.
     * @returns The server's answer.
     */
    protected async postKey(tokenUrl: string, data: { key: string; pin?: string }): Promise<AtyTokenResponse | null> {
        const options: HttpRequestOptions = {
            method: 'post',
            data,
        };

        try {
            const result = await CoreWS.sendHTTPRequest<AtyTokenResponse>(tokenUrl, options);

            return result.body;
        } catch (error) {
            throw new CoreCustomURLSchemesHandleError(new CoreError(Translate.instant('core.login.invalidsite'), {
                debug: { code: 'atylogintokenerror', details: CoreErrorHelper.getErrorMessageFromError(error) ?? '' },
            }));
        }
    }

    /**
     * Open the branded PIN pad. Returns the entered PIN, or forgot=true when the user asks to recover their PIN.
     *
     * @param ui The localised wording for the pad (from the server); a non-empty forgot shows the recovery link.
     * @param validator Optional check that keeps the pad open and shakes it on a wrong PIN.
     * @returns { pin } (undefined when cancelled) or { forgot: true }.
     */
    protected async promptPin(
        ui: AtyPinUi,
        validator?: (pin: string) => Promise<{ ok: boolean; message?: string }>,
    ): Promise<{ pin?: string; forgot?: boolean }> {
        const { AtyPinPadComponent, ATY_PIN_FORGOT } = await import('@/core/components/aty-pin-pad/aty-pin-pad');

        // Hide the "connecting" loading while the pad is up, so it does not sit on top of the keys; restore it
        // afterwards so the caller's own dismiss still balances out.
        await CoreLoadings.pauseActiveModals();

        try {
            const result = await CoreModals.openModal<string>({
                component: AtyPinPadComponent,
                componentProps: {
                    title: ui.title ?? '',
                    message: ui.message ?? '',
                    okText: ui.ok ?? '',
                    cancelText: ui.cancel ?? '',
                    forgotText: ui.forgot ?? '',
                    validator,
                },
                cssClass: 'aty-pin-modal',
                backdropDismiss: true,
            });

            if (result === ATY_PIN_FORGOT) {
                return { forgot: true };
            }

            return { pin: result };
        } finally {
            await CoreLoadings.resumeActiveModals();
        }
    }

    /**
     * After the first passwordless sign-in, offer to set a PIN for next time. Skipping is fine; it can be set later.
     *
     * @param siteUrl The site URL.
     * @param token The freshly minted app token.
     * @param ui The localised wording for the pad (from the server).
     */
    protected async offerPinSetup(siteUrl: string, token: string, ui: AtyPinUi): Promise<void> {
        const { pin } = await this.promptPin(ui);
        if (!pin || !/^\d{4,8}$/.test(pin)) {
            return; // Skipped or not a usable PIN; let them set it later from their profile.
        }

        try {
            await CoreWS.call('local_oksigeniaaty_set_pin', { pin }, { wsToken: token, siteUrl });
        } catch {
            return; // Not critical: they stay signed in and can set a PIN another time.
        }

        // With the PIN set, offer to store it behind the device's fingerprint or face for a touch next time.
        if (ui.biometricask && ui.biometric) {
            const { AtyBiometric } = await import('@services/aty-biometric');
            if (await AtyBiometric.isAvailable()) {
                try {
                    await CoreAlerts.confirm(ui.biometricask);
                    await AtyBiometric.enable(siteUrl, pin, ui.biometric);
                } catch {
                    // Declined or failed; the PIN pad still works.
                }
            }
        }
    }

}

export const AtyLogin = makeSingleton(AtyLoginService);
