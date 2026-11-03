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

import { CoreIonLoadingElement } from '@classes/ion-loading';
import { CoreLoadingsService } from '@services/overlays/loadings';

/**
 * Oksigenia Aty: the pauses of the loadings nest, so an alert closing over Aty's PIN pad does not bring a loading back over it.
 */
class TestLoadingsService extends CoreLoadingsService {

    addModal(modal: CoreIonLoadingElement): void {
        this.activeLoadingModals.push(modal);
    }

}

describe('CoreLoadingsService', () => {

    it('resumes the loadings only when the last pause ends', async () => {
        const loadings = new TestLoadingsService();
        const modal = {
            pause: jest.fn(() => Promise.resolve()),
            resume: jest.fn(() => Promise.resolve()),
        } as unknown as CoreIonLoadingElement;
        loadings.addModal(modal);

        // The PIN pad pauses the loading, then an alert opens and closes on top of the pad.
        await loadings.pauseActiveModals();
        await loadings.pauseActiveModals();
        await loadings.resumeActiveModals();
        expect(modal.resume).not.toHaveBeenCalled();

        // The pad closes: now the loading comes back.
        await loadings.resumeActiveModals();
        expect(modal.resume).toHaveBeenCalledTimes(1);

        // A resume with nothing paused still resumes, as before.
        await loadings.resumeActiveModals();
        expect(modal.resume).toHaveBeenCalledTimes(2);
    });

});
