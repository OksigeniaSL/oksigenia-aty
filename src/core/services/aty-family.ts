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
import { CoreSite } from '@classes/sites/site';

/**
 * The start of the username of the accounts local_oksigeniaaty makes for the adults of a family (the QR of a letter).
 */
export const ATY_FAMILY_USERNAME_PREFIX = 'atyfamily-';

/**
 * Whether a site's account is a family's own: made by the centre's plugin for an adult who entered with a code. It has
 * no courses of its own: what it follows is its children, on the home.
 *
 * @param site The site, or none.
 * @returns Whether it is.
 */
export function atyIsFamilyAccount(site?: Pick<CoreSite, 'getInfo'>): boolean {
    return (site?.getInfo()?.username ?? '').startsWith(ATY_FAMILY_USERNAME_PREFIX);
}
