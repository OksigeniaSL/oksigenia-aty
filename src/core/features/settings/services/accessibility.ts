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
import { CoreUserPreferences } from '@features/user/services/user-preferences';
import { CoreConfig } from '@services/config';
import { makeSingleton } from '@singletons';
import { CoreEvents } from '@static/events';
import { CoreHTMLClasses } from '@static/html-classes';
import { CorePromiseUtils } from '@static/promise-utils';
import { CoreText } from '@static/text';
import { CoreConfigSettingKey } from '@/core/constants';
import { CoreSettingsHelper, CoreZoomLevel } from './settings-helper';

/** Where the choices are kept, on this phone. */
const CONFIG_KEY = 'CoreAccessibilitySettings';
/** The user preference where Oksigenia Access keeps what someone chose on the website. */
const ACCESS_PREFERENCE = 'local_oksigeniaaccess_state';

/**
 * Accessibility settings of the app, each a switch that stays on: nothing floats and nobody who does not need it sees it. What
 * someone chose on the website with Oksigenia Access comes here too, until they change something on this phone.
 */
@Injectable({ providedIn: 'root' })
export class CoreAccessibilityService {

    protected choices: CoreAccessibilityChoices = {};
    protected changedHere = false;

    /**
     * Apply what is stored, and listen for each sign-in.
     */
    async initialize(): Promise<void> {
        const stored = CoreText.parseJSON<CoreAccessibilityStored>(await CoreConfig.get<string>(CONFIG_KEY, '{}'), {});
        this.choices = stored.choices ?? {};
        this.changedHere = !!stored.changedHere;
        this.apply();

        CoreEvents.on(CoreEvents.LOGIN, () => {
            CorePromiseUtils.ignoreErrors(this.followWebsite());
        });
    }

    /**
     * Whether a setting is on.
     *
     * @param setting The setting.
     * @returns Whether it is on.
     */
    isOn(setting: CoreAccessibilitySetting): boolean {
        return !!this.choices[setting];
    }

    /**
     * Change a setting, from now on what counts on this phone. The two fonts exclude each other.
     *
     * @param setting The setting.
     * @param on Whether it is on.
     */
    async set(setting: CoreAccessibilitySetting, on: boolean): Promise<void> {
        this.choices[setting] = on;
        if (on && setting === 'readable') {
            this.choices.dyslexia = false;
        } else if (on && setting === 'dyslexia') {
            this.choices.readable = false;
        }
        this.changedHere = true;
        this.apply();
        await this.store();
    }

    /**
     * What Oksigenia Access keeps for someone, in terms of the app.
     *
     * @param state What the preference holds.
     * @returns The choices.
     */
    static fromAccess(state: Record<string, unknown>): CoreAccessibilityChoices {
        return {
            lineheight: Number(state.lh) > 0,
            readable: !!state.font && !state.dyslexia,
            dyslexia: !!state.dyslexia,
            contrast: !!state.contrast,
            underline: !!state.highlightLinks,
            grayscale: !!state.grayOverlay,
            motion: !!state.pauseAnim,
        };
    }

    /**
     * Take what the person chose on the website of the site they have just entered, unless they changed something here.
     */
    protected async followWebsite(): Promise<void> {
        if (this.changedHere) {
            return;
        }
        const value = await CoreUserPreferences.getPreferenceOnline(ACCESS_PREFERENCE);
        const state = CoreText.parseJSON<Record<string, unknown> | null>(value ?? '', null);
        if (!state) {
            return;
        }
        this.choices = CoreAccessibilityService.fromAccess(state);
        this.apply();
        await this.store();

        const zoom = Number(state.zoom);
        const current = await CoreSettingsHelper.getZoomLevel();
        if (zoom > 0 && current === CoreZoomLevel.NONE) {
            const level = zoom > 1 ? CoreZoomLevel.HIGH : CoreZoomLevel.MEDIUM;
            await CoreConfig.set(CoreConfigSettingKey.ZOOM_LEVEL, level);
            CoreSettingsHelper.applyZoomLevel(level);
        }
    }

    /**
     * Put a class on the document for each setting, which the theme turns into its look.
     */
    protected apply(): void {
        CORE_ACCESSIBILITY_SETTINGS.forEach((setting) => {
            CoreHTMLClasses.toggleModeClass(`aty-a11y-${setting}`, this.isOn(setting));
        });
    }

    /**
     * Keep the choices on this phone.
     */
    protected async store(): Promise<void> {
        const stored: CoreAccessibilityStored = { choices: this.choices, changedHere: this.changedHere };
        await CoreConfig.set(CONFIG_KEY, JSON.stringify(stored));
    }

}

export const CoreAccessibility = makeSingleton(CoreAccessibilityService);

/** The settings, in the order of the page. */
export const CORE_ACCESSIBILITY_SETTINGS = [
    'contrast',
    'readable',
    'dyslexia',
    'lineheight',
    'underline',
    'grayscale',
    'motion',
] as const;

export type CoreAccessibilitySetting = typeof CORE_ACCESSIBILITY_SETTINGS[number];

type CoreAccessibilityChoices = Partial<Record<CoreAccessibilitySetting, boolean>>;

type CoreAccessibilityStored = {
    choices?: CoreAccessibilityChoices;
    changedHere?: boolean;
};
