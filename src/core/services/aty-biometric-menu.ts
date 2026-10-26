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
import {
    CoreUserProfileHandler,
    CoreUserProfileHandlerType,
    CoreUserProfileListHandlerData,
} from '@features/user/services/user-delegate';
import { AtyBiometric } from '@services/aty-biometric';
import { CoreAlerts } from '@services/overlays/alerts';
import { CoreModals } from '@services/overlays/modals';
import { CoreToasts } from '@services/overlays/toasts';
import { CoreSites } from '@services/sites';
import { Translate, makeSingleton } from '@singletons';

/**
 * Oksigenia Aty: the "Fingerprint or face" entry of the account menu. The app signs in with the PIN and never proposes
 * biometrics (many people prefer not to use them); whoever wants a touch instead of the PIN turns it on here, and can
 * turn it off the same way. Turning it on asks for the PIN, checks it with the site and only then stores it behind the
 * device's fingerprint or face (Android keystore); the app never sees any biometric data.
 */
@Injectable({ providedIn: 'root' })
export class AtyBiometricMenuHandlerService implements CoreUserProfileHandler {

    /** The renewal web service of Aty sites: with an empty PIN it tells whether the user has one, with a PIN it checks it. */
    protected static readonly RENEW_FUNCTION = 'local_oksigeniaaty_renew';

    readonly type = CoreUserProfileHandlerType.LIST_ACCOUNT_ITEM;
    name = 'AtyBiometricMenu';
    priority = 90;

    /**
     * @inheritdoc
     */
    async isEnabled(): Promise<boolean> {
        const site = CoreSites.getCurrentSite();
        if (!site || !site.wsAvailable(AtyBiometricMenuHandlerService.RENEW_FUNCTION)) {
            return false;
        }

        return await AtyBiometric.isAvailable();
    }

    /**
     * @inheritdoc
     */
    getDisplayData(): CoreUserProfileListHandlerData {
        return {
            class: 'aty-biometric-menu',
            icon: 'fas-fingerprint',
            title: 'core.aty.biometric',
            action: async (event): Promise<void> => {
                event.preventDefault();
                event.stopPropagation();

                await this.toggle();
            },
        };
    }

    /**
     * Turn the fingerprint or face on (asking and checking the PIN) or off, after confirming with the user.
     */
    protected async toggle(): Promise<void> {
        const site = CoreSites.getCurrentSite();
        if (!site) {
            return;
        }

        try {
            if ((await AtyBiometric.enrolledSite()) === site.getURL()) {
                await CoreAlerts.confirm(Translate.instant('core.aty.biometricaskdisable'), {
                    okText: Translate.instant('core.aty.biometricdisable'),
                });
                await AtyBiometric.disable();
                await CoreToasts.show({ message: 'core.aty.biometricdisabled', translateMessage: true });

                return;
            }

            // Ask with "Only PIN" as the way out, so declining is the obvious choice.
            await CoreAlerts.confirm(Translate.instant('core.aty.biometricaskenable'), {
                okText: Translate.instant('core.aty.biometricenable'),
                cancelText: Translate.instant('core.aty.biometricdisable'),
            });
        } catch {
            // The user kept things as they were.
            return;
        }

        const ask = await this.call(site, '');
        if (!ask) {
            await CoreAlerts.showError(Translate.instant('core.networkerrormsg'));

            return;
        }
        if (!ask.needspin) {
            // No PIN yet: there is nothing to keep behind the fingerprint or face.
            await CoreAlerts.show({ message: Translate.instant('core.aty.biometricneedspin') });

            return;
        }

        const pin = await this.askPin(site, ask);
        if (!pin) {
            return;
        }

        if (await AtyBiometric.enable(site.getURL(), pin, ask.biometric)) {
            await CoreToasts.show({ message: 'core.aty.biometricenabled', translateMessage: true });
        }
    }

    /**
     * Ask for the PIN with the branded pad and check it with the site, so only a right PIN is stored.
     *
     * @param site The site.
     * @param ask The site's wording for the pad.
     * @returns The checked PIN, or undefined when the user cancels.
     */
    protected async askPin(site: CoreSite, ask: AtyBiometricRenewResponse): Promise<string | undefined> {
        // Imported lazily, like the other Aty uses of the pad, so this service does not statically depend on it.
        const { AtyPinPadComponent } = await import('@/core/components/aty-pin-pad/aty-pin-pad');
        let checked: string | undefined;

        await CoreModals.openModal<string>({
            component: AtyPinPadComponent,
            componentProps: {
                title: ask.title,
                okText: ask.ok,
                cancelText: ask.cancel,
                validator: async (candidate: string) => {
                    const result = await this.call(site, candidate);
                    if (result && !result.needspin) {
                        checked = candidate;

                        return { ok: true };
                    }

                    return { ok: false, message: result?.error };
                },
            },
            cssClass: 'aty-pin-modal',
            backdropDismiss: true,
        });

        return checked;
    }

    /**
     * Call the renewal web service (a right PIN also renews the token, which does no harm).
     *
     * @param site The site.
     * @param pin The PIN, or empty to ask whether the user has one.
     * @returns The response, or undefined on failure.
     */
    protected async call(site: CoreSite, pin: string): Promise<AtyBiometricRenewResponse | undefined> {
        try {
            return await site.write<AtyBiometricRenewResponse>(AtyBiometricMenuHandlerService.RENEW_FUNCTION, { pin });
        } catch {
            return undefined;
        }
    }

}

export const AtyBiometricMenuHandler = makeSingleton(AtyBiometricMenuHandlerService);

/**
 * The part of what local_oksigeniaaty_renew answers that this uses.
 */
type AtyBiometricRenewResponse = {
    needspin: boolean;
    error: string;
    title: string;
    ok: string;
    cancel: string;
    biometric: string;
};
