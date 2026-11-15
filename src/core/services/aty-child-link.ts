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
import { CoreContentLinksHandlerBase } from '@features/contentlinks/classes/base-handler';
import { CoreContentLinksAction } from '@features/contentlinks/services/contentlinks-delegate';
import { CoreNavigator } from '@services/navigator';
import { makeSingleton, Translate } from '@singletons';
import { Md5 } from 'ts-md5';

/**
 * Oksigenia Aty: a link to /local/oksigeniaaty/child.php?id=<the child's user id> opens the page of that child, the same
 * one the home opens for an adult of their family. A notice about a child (the canteen, the library) leads straight to it;
 * the site checks that the adult is of the child's family, as it does from the home.
 */
@Injectable({ providedIn: 'root' })
export class AtyChildLinkHandlerService extends CoreContentLinksHandlerBase {

    name = 'AtyChildLinkHandler';
    pattern = /\/local\/oksigeniaaty\/child\.php.*([?&]id=\d+)/;

    /**
     * @inheritdoc
     */
    getActions(siteIds: string[], url: string, params: Record<string, string>): CoreContentLinksAction[] {
        const args = { childid: parseInt(params.id, 10) };

        return [{
            action: async (siteId): Promise<void> => {
                await CoreNavigator.navigateToSitePath(
                    `siteplugins/content/local_oksigeniaaty/mobile_child/${Md5.hashAsciiStr(JSON.stringify(args))}`,
                    {
                        siteId,
                        params: { title: Translate.instant('core.aty.child'), args },
                    },
                );
            },
        }];
    }

}

export const AtyChildLinkHandler = makeSingleton(AtyChildLinkHandlerService);
