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
import { atyHttpsUrl } from '@static/aty-https';

describe('atyHttpsUrl', () => {

    it('asks for an http resource of another site over https', () => {
        expect(atyHttpsUrl('http://upload.example.org/a/b.png?x=1#y')).toEqual('https://upload.example.org/a/b.png?x=1#y');
        expect(atyHttpsUrl('HTTP://Example.org/video.mp4')).toEqual('https://Example.org/video.mp4');
        expect(atyHttpsUrl('http://example.org:8080/x.png')).toEqual('https://example.org:8080/x.png');
    });

    it('leaves alone what is not http', () => {
        expect(atyHttpsUrl('https://example.org/x.png')).toEqual('https://example.org/x.png');
        expect(atyHttpsUrl('data:image/png;base64,AAAA')).toEqual('data:image/png;base64,AAAA');
        expect(atyHttpsUrl('file:///storage/x.png')).toEqual('file:///storage/x.png');
        expect(atyHttpsUrl('/pluginfile.php/1/x.png')).toEqual('/pluginfile.php/1/x.png');
        expect(atyHttpsUrl('')).toEqual('');
    });

    it('keeps http for the local demo on this machine', () => {
        expect(atyHttpsUrl('http://localhost:8000/pluginfile.php/1/x.png')).toEqual('http://localhost:8000/pluginfile.php/1/x.png');
        expect(atyHttpsUrl('http://127.0.0.1/x.png')).toEqual('http://127.0.0.1/x.png');
        expect(atyHttpsUrl('http://[::1]:8000/x.png')).toEqual('http://[::1]:8000/x.png');
    });

    it('does not mistake a host that only starts like a loopback one', () => {
        expect(atyHttpsUrl('http://localhost.example.org/x.png')).toEqual('https://localhost.example.org/x.png');
        expect(atyHttpsUrl('http://127.0.0.1.example.org/x.png')).toEqual('https://127.0.0.1.example.org/x.png');
    });

    it('leaves alone an address it cannot read', () => {
        expect(atyHttpsUrl('http://')).toEqual('http://');
    });
});
