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

import { mockSingleton } from '@/testing/utils';
import { CoreConfig } from '@services/config';
import { CoreAccessibility, CoreAccessibilityService } from '../services/accessibility';

describe('Accessibility settings', () => {

    let stored: Record<string, unknown>;

    beforeEach(() => {
        stored = {};
        mockSingleton(CoreConfig, {
            get: async (name: string, defaultValue?: unknown) => stored[name] ?? defaultValue,
            set: async (name: string, value: unknown) => {
                stored[name] = value;
            },
        });
        document.documentElement.className = '';
    });

    it('reads what Oksigenia Access keeps', () => {
        const choices = CoreAccessibilityService.fromAccess({
            lh: 2,
            font: true,
            dyslexia: true,
            contrast: true,
            highlightLinks: false,
            grayOverlay: false,
            pauseAnim: true,
        });

        expect(choices).toEqual({
            lineheight: true,
            readable: false,
            dyslexia: true,
            contrast: true,
            underline: false,
            grayscale: false,
            motion: true,
        });
        expect(CoreAccessibilityService.fromAccess({}).contrast).toBe(false);
    });

    it('puts a class on the document, and the two fonts exclude each other', async () => {
        await CoreAccessibility.set('readable', true);
        expect(document.documentElement.classList.contains('aty-a11y-readable')).toBe(true);

        await CoreAccessibility.set('dyslexia', true);
        expect(CoreAccessibility.isOn('readable')).toBe(false);
        expect(document.documentElement.classList.contains('aty-a11y-readable')).toBe(false);
        expect(document.documentElement.classList.contains('aty-a11y-dyslexia')).toBe(true);

        await CoreAccessibility.set('dyslexia', false);
        expect(document.documentElement.classList.contains('aty-a11y-dyslexia')).toBe(false);
    });

});
