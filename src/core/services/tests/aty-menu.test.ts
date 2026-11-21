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
import { ATY_MENU_COURSE_ENTRIES, ATY_MENU_FILES, atyMenuHidden } from '@services/aty-menu';

describe('atyMenuHidden', () => {

    it('leaves a family without course entries nor files', () => {
        expect(atyMenuHidden(true, false)).toEqual([...ATY_MENU_COURSE_ENTRIES, ATY_MENU_FILES]);
        expect(atyMenuHidden(true, true)).toEqual([...ATY_MENU_COURSE_ENTRIES, ATY_MENU_FILES]);
    });

    it('leaves the office without course entries, with its files', () => {
        expect(atyMenuHidden(false, false)).toEqual(ATY_MENU_COURSE_ENTRIES);
        expect(atyMenuHidden(false, false)).not.toContain(ATY_MENU_FILES);
    });

    it('leaves a teacher or a pupil with everything', () => {
        expect(atyMenuHidden(false, true)).toEqual([]);
    });
});
