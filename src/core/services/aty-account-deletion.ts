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

import { CoreDataPrivacy } from '@features/dataprivacy/services/dataprivacy';
import {
    CoreUserProfileHandler,
    CoreUserProfileHandlerType,
    CoreUserProfileListHandlerData,
} from '@features/user/services/user-delegate';
import { CoreLang } from '@services/lang';
import { makeSingleton } from '@singletons';

/**
 * Oksigenia Aty: a "Delete my account" entry in the account menu for sites that do not offer the platform's own privacy
 * requests. It opens Oksigenia's page on how to ask the school or organisation (the data controller) to delete the
 * account, so every hosted site keeps an in-app way to start a deletion request; it never deletes anything by itself.
 * Where the site has its privacy requests on, this entry hides and the core one is used, with each role's permissions
 * (self-service deletion for adults, none for minors, as each client decides).
 */
@Injectable({ providedIn: 'root' })
export class AtyAccountDeletionHandlerService implements CoreUserProfileHandler {

    /** Oksigenia's public page on how to request the deletion of an Aty account (Spanish, the legally binding one). */
    static readonly DELETION_URL = 'https://oksigenia.com/aty/borrar-cuenta';

    /** The same page in English, for the languages that are not spoken in Spain. */
    static readonly DELETION_URL_EN = 'https://oksigenia.com/en/aty/delete-account';

    readonly type = CoreUserProfileHandlerType.LIST_ACCOUNT_ITEM;
    name = 'AtyAccountDeletion';
    priority = 100;

    /**
     * @inheritdoc
     */
    async isEnabled(): Promise<boolean> {
        try {
            return !(await CoreDataPrivacy.isEnabled());
        } catch {
            // If the site cannot tell, keep the way to request a deletion available.
            return true;
        }
    }

    /**
     * @inheritdoc
     */
    getDisplayData(): CoreUserProfileListHandlerData {
        return {
            class: 'aty-account-deletion',
            icon: 'fas-user-xmark',
            title: 'core.dataprivacy.deletemyaccount',
            action: async (event): Promise<void> => {
                event.preventDefault();
                event.stopPropagation();

                // The base of the language code (es_mx → es, ca_valencia → ca) decides which page to open.
                const lang = (await CoreLang.getCurrentLanguage()).split(/[-_]/)[0];
                const url = ['es', 'ca', 'gl', 'eu'].includes(lang)
                    ? AtyAccountDeletionHandlerService.DELETION_URL
                    : AtyAccountDeletionHandlerService.DELETION_URL_EN;

                // Imported lazily so this service does not statically depend on the opener.
                const { CoreOpener } = await import('@static/opener');
                await CoreOpener.openInBrowser(url);
            },
        };
    }

}

export const AtyAccountDeletionHandler = makeSingleton(AtyAccountDeletionHandlerService);
