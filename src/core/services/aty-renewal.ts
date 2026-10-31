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

import { CoreSite } from '@classes/sites/site';
import { CoreConfig } from '@services/config';
import { CoreModals } from '@services/overlays/modals';
import { CorePlatform } from '@services/platform';
import { CoreSites } from '@services/sites';
import { makeSingleton } from '@singletons';
import { CoreEvents } from '@static/events';

/**
 * Keeps an Oksigenia Aty session from falling: before the app token expires, it renews it with the user's PIN (no
 * password, no new magic link) by calling local_oksigeniaaty_renew, reusing the branded PIN pad.
 */
@Injectable({ providedIn: 'root' })
export class AtyRenewalService {

    /** The renewal web service, present only on Aty-hosted sites. */
    protected static readonly RENEW_FUNCTION = 'local_oksigeniaaty_renew';

    /** Offer to renew once the token is within this many seconds of expiring (14 days). */
    protected static readonly RENEW_WINDOW = 14 * 24 * 60 * 60;

    /** The stored expiry of a token that never expires (0 means not known yet). */
    protected static readonly NEVER = -1;

    /** The token expiry learned at sign-in, keyed by site URL, until the site exists and we can store it per site. */
    protected pending: Record<string, number> = {};

    /** Guard against overlapping checks (e.g. a resume while a prompt is open). */
    protected checking = false;

    /**
     * Start listening for sign-ins and app resumes.
     */
    initialize(): void {
        CoreEvents.on(CoreEvents.LOGIN, async ({ siteId }) => {
            await this.storePending(siteId);
            await this.checkCurrentSite();
        });

        CorePlatform.resume.subscribe(async () => {
            await this.checkCurrentSite();
        });
    }

    /**
     * Remember the token expiry the app learned at sign-in, to store once the site exists.
     *
     * @param siteUrl The site URL.
     * @param validuntil The token expiry (unix time, 0 if it never expires).
     */
    rememberValidUntil(siteUrl: string, validuntil: number): void {
        this.pending[siteUrl] = validuntil;
    }

    /**
     * Move a remembered expiry into the site's own storage once it exists.
     *
     * @param siteId The site that just logged in.
     */
    protected async storePending(siteId: string): Promise<void> {
        try {
            const site = await CoreSites.getSite(siteId);
            const url = site.getURL();
            if (url in this.pending) {
                await this.store(site, this.pending[url]);
                delete this.pending[url];
            }
        } catch {
            // Ignore: at worst we miss one renewal window and the user re-authenticates with a fresh link.
        }
    }

    /**
     * If the current site is an Aty site whose token is close to expiring, renew it.
     */
    protected async checkCurrentSite(): Promise<void> {
        if (this.checking || !CoreSites.isLoggedIn()) {
            return;
        }

        const site = CoreSites.getCurrentSite();
        if (!site || !site.wsAvailable(AtyRenewalService.RENEW_FUNCTION)) {
            return;
        }

        this.checking = true;
        try {
            const validuntil = await CoreConfig.get<number>(this.key(site), 0);
            const now = Math.floor(Date.now() / 1000);

            // Signed in with a password, the app never learned when its token expires; or the stored date has passed, so
            // it belongs to an older token (the user is signed in, so the current one is alive): ask the site.
            if (validuntil === 0 || (validuntil !== AtyRenewalService.NEVER && validuntil <= now)) {
                await this.learn(site);

                return;
            }

            // Only when it expires and it is close.
            if (validuntil === AtyRenewalService.NEVER || validuntil - now > AtyRenewalService.RENEW_WINDOW) {
                return;
            }

            await this.renew(site);
        } catch {
            // A renewal check must never get in the user's way.
        } finally {
            this.checking = false;
        }
    }

    /**
     * Renew the site's token: silently when there is no PIN, otherwise by asking for it with the PIN pad.
     *
     * @param site The site to renew.
     */
    protected async renew(site: CoreSite): Promise<void> {
        const first = await this.call(site, '');
        if (!first) {
            return;
        }

        if (!first.needspin) {
            await this.store(site, first.validuntil);

            return;
        }

        // Biometric shortcut: if this site's PIN is stored behind the fingerprint/face, unlock it and renew without
        // showing the pad. On cancel or a stale PIN, fall through to the pad.
        if (first.biometric) {
            const { AtyBiometric } = await import('@services/aty-biometric');
            if ((await AtyBiometric.enrolledSite()) === site.getURL() && await AtyBiometric.isAvailable()) {
                const pin = await AtyBiometric.unlockPin(first.biometric);
                if (pin) {
                    const result = await this.call(site, pin);
                    if (result && !result.needspin) {
                        await this.store(site, result.validuntil);

                        return;
                    }
                }
            }
        }

        const { AtyPinPadComponent } = await import('@/core/components/aty-pin-pad/aty-pin-pad');
        let renewed: AtyRenewResponse | undefined;

        await CoreModals.openModal<string>({
            component: AtyPinPadComponent,
            componentProps: {
                title: first.title,
                okText: first.ok,
                cancelText: first.cancel,
                validator: async (pin: string) => {
                    const result = await this.call(site, pin);
                    if (result && !result.needspin) {
                        renewed = result;

                        return { ok: true };
                    }

                    return { ok: false, message: result?.error };
                },
            },
            cssClass: 'aty-pin-modal',
            backdropDismiss: true,
        });

        if (renewed) {
            await this.store(site, renewed.validuntil);
        }
    }

    /**
     * Call the renewal web service.
     *
     * @param site The site.
     * @param pin The PIN (empty to ask for the pad wording, or when there is no PIN).
     * @returns The response, or undefined on failure.
     */
    protected async call(site: CoreSite, pin: string): Promise<AtyRenewResponse | undefined> {
        try {
            return await site.write<AtyRenewResponse>(AtyRenewalService.RENEW_FUNCTION, { pin });
        } catch {
            return undefined;
        }
    }

    /**
     * Learn when the site's token expires. With a PIN, the site only says when, and the PIN is asked later, in the
     * renewal window; without one, a valid token is enough and the site renews it there and then.
     *
     * @param site The site.
     */
    protected async learn(site: CoreSite): Promise<void> {
        const result = await this.call(site, '');
        if (!result || (result.needspin && !result.validuntil)) {
            // An older plugin does not say when while it asks for the PIN: try again on the next resume.
            return;
        }

        await this.store(site, result.validuntil);
    }

    /**
     * Store a token expiry for a site.
     *
     * @param site The site.
     * @param validuntil The expiry (unix time, 0 if it never expires).
     */
    protected async store(site: CoreSite, validuntil: number): Promise<void> {
        try {
            await CoreConfig.set(this.key(site), validuntil > 0 ? validuntil : AtyRenewalService.NEVER);
        } catch {
            // Ignore storage errors.
        }
    }

    /**
     * The config key that holds a site's token expiry.
     *
     * @param site The site.
     * @returns The key.
     */
    protected key(site: CoreSite): string {
        return `aty_token_validuntil_${site.getId()}`;
    }

}

export const AtyRenewal = makeSingleton(AtyRenewalService);

/**
 * What local_oksigeniaaty_renew answers.
 */
type AtyRenewResponse = {
    needspin: boolean;
    token: string;
    validuntil: number;
    error: string;
    title: string;
    ok: string;
    cancel: string;
    biometric: string;
};
