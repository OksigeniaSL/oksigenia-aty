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
import { atyIsFamilyAccount } from '@services/aty-family';
import { CoreSite } from '@classes/sites/site';

describe('atyIsFamilyAccount', () => {

    const site = (username?: string): Pick<CoreSite, 'getInfo'> =>
        ({ getInfo: () => (username === undefined ? undefined : { username }) }) as unknown as Pick<CoreSite, 'getInfo'>;

    it('knows a family account by its username', () => {
        expect(atyIsFamilyAccount(site('atyfamily-12'))).toBe(true);
        expect(atyIsFamilyAccount(site('a.eso1a'))).toBe(false);
        expect(atyIsFamilyAccount(site())).toBe(false);
        expect(atyIsFamilyAccount(undefined)).toBe(false);
    });

});
