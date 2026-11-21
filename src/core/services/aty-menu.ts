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

/** The account menu's entries about courses: grades, reports and badges. */
export const ATY_MENU_COURSE_ENTRIES = ['CoreGrades:fakename', 'CoreReportBuilderDelegate', 'AddonBadges:fakename'];

/** The account menu's entry of the private files. */
export const ATY_MENU_FILES = 'AddonPrivateFiles';

/** The entry that asks the centre to delete the account: it goes last and apart, explained. */
export const ATY_MENU_DELETION = 'AtyAccountDeletion';

/**
 * Which entries of the account menu an account does not show, so that each one sees what is its own: a family's account
 * has no courses nor files of its own; an account with no courses (the office staff) has files but no grades, reports
 * nor badges; a teacher or a pupil sees them all.
 *
 * @param isFamily Whether it is a family's own account.
 * @param hasCourses Whether the account is in any course.
 * @returns The names of the handlers to leave out.
 */
export function atyMenuHidden(isFamily: boolean, hasCourses: boolean): string[] {
    if (isFamily) {
        return [...ATY_MENU_COURSE_ENTRIES, ATY_MENU_FILES];
    }

    return hasCourses ? [] : [...ATY_MENU_COURSE_ENTRIES];
}
