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

import { NotificationEventResponse } from '@awesome-cordova-plugins/push/ngx';

import { mockSingleton } from '@/testing/utils';
import { CorePushNotifications } from '@features/pushnotifications/services/pushnotifications';
import { CorePushNotificationsDelegate } from '@features/pushnotifications/services/push-delegate';
import { CoreLocalNotifications } from '@services/local-notifications';
import { CorePlatform } from '@services/platform';
import { CoreSites } from '@services/sites';
import { ApplicationInit } from '@singletons';

/**
 * Oksigenia Aty: a notice with the app on screen is shown once. iOS shows an encrypted notice that the notification service
 * extension has decrypted (the push plugin marks it shownbyios); the app shows any other notice itself, as before.
 */
describe('CorePushNotifications foreground notices', () => {

    let schedule: jest.Mock;
    let received: jest.Mock;
    let clicked: jest.Mock;

    /**
     * A notice as the push plugin hands it to the app.
     *
     * @param additionalData The plugin's additionalData.
     * @returns The notice.
     */
    const notice = (additionalData: Record<string, unknown>): NotificationEventResponse => <NotificationEventResponse> {
        title: 'Colegio de ejemplo',
        message: 'Tienes una nota nueva en Ciencias',
        additionalData: { site: 'site-1', notId: '4711', notif: '1', ...additionalData },
    };

    beforeEach(() => {
        schedule = jest.fn(() => Promise.resolve());
        received = jest.fn();
        clicked = jest.fn(() => Promise.resolve());

        mockSingleton(CoreSites, {
            getSite: () => Promise.resolve({ getId: () => 'site-1' }),
            isLoggedIn: () => true,
            runAfterLoginNavigation: ({ callback }: { callback: () => Promise<void> }) => callback(),
        });
        mockSingleton(CoreLocalNotifications, { schedule });
        mockSingleton(CorePushNotificationsDelegate, { received, clicked });
        mockSingleton(CorePlatform, { isAndroid: () => false });
        mockSingleton(ApplicationInit, { donePromise: Promise.resolve() });
    });

    it('lets iOS show an encrypted notice the extension decrypted, and still tells the app', async () => {
        await CorePushNotifications.onMessageReceived(notice({
            foreground: true,
            encrypted: '1',
            silentencryptedtriggeredbyplugin: true,
            shownbyios: true,
        }));

        expect(schedule).not.toHaveBeenCalled();
        expect(received).toHaveBeenCalledTimes(1);
        expect(received.mock.calls[0][0]).toEqual(expect.objectContaining({ site: 'site-1', foreground: true }));
    });

    it('shows a notice that is not encrypted itself, once, as before', async () => {
        await CorePushNotifications.onMessageReceived(notice({ foreground: true }));

        expect(schedule).toHaveBeenCalledTimes(1);
        expect(schedule.mock.calls[0][0]).toEqual(expect.objectContaining({
            id: 4711,
            title: 'Colegio de ejemplo',
            text: 'Tienes una nota nueva en Ciencias',
        }));
        expect(received).toHaveBeenCalledTimes(1);
    });

    it('opens a tapped notice, whoever showed it', async () => {
        await CorePushNotifications.onMessageReceived(notice({ foreground: false, shownbyios: true }));

        expect(clicked).toHaveBeenCalledTimes(1);
        expect(schedule).not.toHaveBeenCalled();
        expect(received).not.toHaveBeenCalled();
    });

});
