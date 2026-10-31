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

import { CoreStyleHandler, CoreStyles, CoreStylesService } from '@features/styles/services/styles';
import { CoreSites, CoreSitesReadingStrategy } from '@services/sites';
import { makeSingleton } from '@singletons';
import { CorePromiseUtils } from '@static/promise-utils';

/**
 * Oksigenia Aty: a user's own brand on top of the site's sheet. In a site shared by several schools or libraries (such
 * as ayvurenda.com), each person sees theirs: local_oksigeniaaty gives the colours of the user's school or library, and
 * this sheet goes after the site's own (mobilecssurl), so it wins. Where no plugin gives a brand, it is empty and the
 * site's look stays. The official Moodle app shows the site's look.
 */
@Injectable({ providedIn: 'root' })
export class AtyUserStyleService implements CoreStyleHandler {

    /** The web service, present only on sites with local_oksigeniaaty 0.5.26 or later. */
    protected static readonly FUNCTION = 'local_oksigeniaaty_get_user_style';

    name = 'atyuserstyle';
    priority = 1100; // After the site's own sheet (mobilecssurl, 1000).

    /**
     * Register the sheet with the app's styles.
     */
    initialize(): void {
        CoreStyles.registerStyleHandler(this);
    }

    /**
     * @inheritdoc
     */
    async isEnabled(siteId: string): Promise<boolean> {
        if (siteId === CoreStylesService.TMP_SITE_ID) {
            return false;
        }
        const site = await CorePromiseUtils.ignoreErrors(CoreSites.getSite(siteId));

        return !!site && !site.isLoggedOut() && site.wsAvailable(AtyUserStyleService.FUNCTION);
    }

    /**
     * @inheritdoc
     */
    async getStyle(siteId?: string): Promise<string> {
        const site = await CoreSites.getSite(siteId);
        const result = await CorePromiseUtils.ignoreErrors(site.read<{ css: string }>(
            AtyUserStyleService.FUNCTION,
            {},
            CoreSites.getReadingStrategyPreSets(CoreSitesReadingStrategy.PREFER_NETWORK),
        ));

        return result?.css ?? '';
    }

}

export const AtyUserStyle = makeSingleton(AtyUserStyleService);
