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
import { AtyChildLinkHandlerService } from '@services/aty-child-link';
import { CoreNavigator } from '@services/navigator';
import { Md5 } from 'ts-md5';

/**
 * Oksigenia Aty: a notice about a child opens the page of that child in the app.
 */
describe('AtyChildLinkHandler', () => {

    const handler = new AtyChildLinkHandlerService();

    it('handles the child page of a site, and nothing else', () => {
        // The delegate passes the address without the site, as it does to every handler.
        expect(handler.handles('/local/oksigeniaaty/child.php?id=45')).toBe(true);
        expect(handler.handles('/local/oksigeniaaty/child.php')).toBe(false);
        expect(handler.handles('/local/oksigeniaaty/mylink.php?id=45')).toBe(false);
        expect(handler.handles('/mod/page/view.php?id=45&x=/local/oksigeniaaty/child.php?id=45')).toBe(false);
    });

    it('opens the page of the child as the home does', async () => {
        overrideTranslations({ 'core.aty.child': 'Your child' }, 'en');
        const navigateToSitePath = jest.fn(async () => true);
        mockSingleton(CoreNavigator, { navigateToSitePath });

        const actions = handler.getActions(['site-1'], 'https://aula.example.com/local/oksigeniaaty/child.php?id=45', { id: '45' });
        await actions[0].action('site-1');

        const args = { childid: 45 };
        expect(navigateToSitePath).toHaveBeenCalledWith(
            `siteplugins/content/local_oksigeniaaty/mobile_child/${Md5.hashAsciiStr(JSON.stringify(args))}`,
            { siteId: 'site-1', params: { title: 'Your child', args } },
        );
    });

});
