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

import { Component, OnInit } from '@angular/core';
import { CORE_SETTINGS_GENERAL_PAGE_NAME, CORE_SETTINGS_PAGE_NAME } from '@features/settings/constants';
import {
    CORE_ACCESSIBILITY_SETTINGS,
    CoreAccessibility,
    CoreAccessibilitySetting,
} from '@features/settings/services/accessibility';
import { CoreNavigator } from '@services/navigator';
import { CoreSharedModule } from '@/core/shared.module';

/**
 * Page that switches on what makes the app easier for someone.
 */
@Component({
    selector: 'page-core-app-settings-accessibility',
    templateUrl: 'accessibility.html',
    imports: [
        CoreSharedModule,
    ],
})
export default class CoreSettingsAccessibilityPage implements OnInit {

    settings: { key: CoreAccessibilitySetting; on: boolean }[] = [];

    /**
     * @inheritdoc
     */
    ngOnInit(): void {
        this.refresh();
    }

    /**
     * A switch has changed.
     *
     * @param key The setting.
     * @param event The change.
     */
    async changed(key: CoreAccessibilitySetting, event: CustomEvent<{ checked: boolean }>): Promise<void> {
        await CoreAccessibility.set(key, !!event.detail.checked);
        this.refresh();
    }

    /**
     * Go to the text size, which is in the general settings.
     */
    openTextSize(): void {
        CoreNavigator.navigateToSitePath(`${CORE_SETTINGS_PAGE_NAME}/${CORE_SETTINGS_GENERAL_PAGE_NAME}`);
    }

    /**
     * Read the switches again: the two fonts exclude each other.
     */
    protected refresh(): void {
        this.settings = CORE_ACCESSIBILITY_SETTINGS.map((key) => ({ key, on: CoreAccessibility.isOn(key) }));
    }

}
