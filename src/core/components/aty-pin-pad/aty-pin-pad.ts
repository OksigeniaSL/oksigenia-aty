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

import { Component, computed, input, signal } from '@angular/core';

import { CoreBaseModule } from '@/core/base.module';
import { ModalController } from '@singletons';

/**
 * A branded PIN pad for Oksigenia Aty: dots that fill as you type, a strength bar that grows from 4 to 6 digits, and
 * an on-screen number pad whose keys can be shuffled so a shoulder-surfer cannot read the PIN from finger positions.
 *
 * All its wording (title, message, buttons) is passed in, already localised by the server, so the app ships no PIN
 * strings of its own. It closes with the entered PIN, or with undefined when the user cancels.
 */
/** The pad closes with this value when the user taps "forgot your PIN?". */
export const ATY_PIN_FORGOT = '__aty_pin_forgot__';

@Component({
    selector: 'aty-pin-pad',
    templateUrl: 'aty-pin-pad.html',
    styleUrl: 'aty-pin-pad.scss',
    imports: [CoreBaseModule],
})
export class AtyPinPadComponent {

    readonly title = input('');
    readonly message = input('');
    readonly okText = input('');
    readonly cancelText = input('');
    readonly forgotText = input(''); // When set, a "forgot your PIN?" link is shown; empty hides it.
    readonly minLength = input(4);
    readonly maxLength = input(8);
    // When given, the entered PIN is checked against the server without closing the pad: a wrong PIN shakes the pad
    // in place instead of signing in. Without it (setting a new PIN), the pad just returns what was typed.
    readonly validator = input<((pin: string) => Promise<AtyPinValidation>) | undefined>(undefined);

    readonly pin = signal('');
    readonly shuffled = signal(false);
    readonly digits = signal<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    readonly error = signal('');
    readonly shaking = signal(false);
    readonly busy = signal(false);

    /** One boolean per dot: filled up to the entered length, empty after. */
    readonly dots = computed(() => {
        const length = this.pin().length;

        return Array.from({ length: this.maxLength() }, (_, i) => i < length);
    });

    /** Strength 0..3: nothing under 4 digits, then weak (4), medium (5), strong (6+). */
    readonly strength = computed(() => {
        const length = this.pin().length;

        if (length < 4) {
            return 0;
        }

        return Math.min(length - 3, 3);
    });

    readonly canSubmit = computed(() => this.pin().length >= this.minLength());

    readonly topKeys = computed(() => this.digits().slice(0, 9));
    readonly lastKey = computed(() => this.digits()[9]);

    constructor() {
        // Remember on this device whether the user prefers a shuffled pad.
        try {
            if (localStorage.getItem('aty_pin_shuffle') === '1') {
                this.shuffled.set(true);
                this.reshuffle();
            }
        } catch {
            // Private mode or blocked storage: just keep the ordered pad.
        }
    }

    /**
     * Append a digit, up to the maximum length.
     *
     * @param digit The digit pressed.
     */
    press(digit: number): void {
        if (this.busy() || this.pin().length >= this.maxLength()) {
            return;
        }

        this.error.set('');
        this.pin.update(value => value + digit);
    }

    /**
     * Remove the last digit.
     */
    backspace(): void {
        if (this.busy()) {
            return;
        }

        this.error.set('');
        this.pin.update(value => value.slice(0, -1));
    }

    /**
     * Turn the shuffled pad on or off, remembering the choice on this device.
     */
    toggleShuffle(): void {
        const next = !this.shuffled();
        this.shuffled.set(next);

        try {
            localStorage.setItem('aty_pin_shuffle', next ? '1' : '0');
        } catch {
            // Ignore storage errors; the toggle still works for this session.
        }

        if (next) {
            this.reshuffle();
        } else {
            this.digits.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
        }
    }

    /**
     * Shuffle the digit positions (Fisher-Yates).
     */
    protected reshuffle(): void {
        const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        for (let i = digits.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [digits[i], digits[j]] = [digits[j], digits[i]];
        }

        this.digits.set(digits);
    }

    /**
     * Submit the PIN. Without a validator, close and return it. With one, check it against the server: on success
     * close, on a wrong PIN shake the pad, show the message and clear the digits so the user can try again.
     */
    async submit(): Promise<void> {
        if (!this.canSubmit() || this.busy()) {
            return;
        }

        const validator = this.validator();
        if (!validator) {
            ModalController.dismiss(this.pin());

            return;
        }

        this.busy.set(true);
        this.error.set('');

        let message = '';
        try {
            const result = await validator(this.pin());
            if (result.ok) {
                ModalController.dismiss(this.pin());

                return;
            }
            message = result.message ?? '';
        } catch {
            // Treat an unexpected failure like a rejected PIN, so the user can try again rather than get stuck.
            message = '';
        } finally {
            this.busy.set(false);
        }

        // Wrong PIN: shake, show the reason, and clear the digits once the shake is done.
        this.error.set(message);
        this.shaking.set(true);
        setTimeout(() => {
            this.shaking.set(false);
            this.pin.set('');
        }, 450);
    }

    /**
     * Close without a PIN.
     */
    cancel(): void {
        if (!this.busy()) {
            ModalController.dismiss(undefined);
        }
    }

    /**
     * Close asking to recover a forgotten PIN.
     */
    forgot(): void {
        if (!this.busy()) {
            ModalController.dismiss(ATY_PIN_FORGOT);
        }
    }

}

/**
 * What a PIN validator reports back: whether the PIN was accepted, and a message to show when it was not.
 */
export type AtyPinValidation = {
    ok: boolean;
    message?: string;
};
