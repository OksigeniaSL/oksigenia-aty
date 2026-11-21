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
import { atyReadableUrl } from '@static/aty-readable-url';

describe('atyReadableUrl', () => {

    it('shows the site and the path, not the query', () => {
        expect(atyReadableUrl('https://wa.me/?text=La%20compra%20de%20las%20cenas%0A-%20Aceite'))
            .toEqual('https://wa.me');
        expect(atyReadableUrl('https://example.org/una%20ruta/doc.pdf?x=1#arriba'))
            .toEqual('https://example.org/una ruta/doc.pdf');
    });

    it('leaves alone what it cannot read', () => {
        expect(atyReadableUrl('not a url')).toEqual('not a url');
        expect(atyReadableUrl('https://example.org/%E0%A4%A')).toEqual('https://example.org/%E0%A4%A');
    });

    it('never lets the address carry markup or turn the text around', () => {
        const fake = 'https://evil.example/%3C/b%3E%3C/p%3E%3Cp%3E%3Cb%3Ehttps://aula.centro.example/curso%3C/b%3E';
        const shown = atyReadableUrl(fake);
        expect(shown).not.toContain('<');
        expect(shown).not.toContain('>');
        expect(shown).toContain('&lt;/b&gt;');
        expect(atyReadableUrl('https://evil.example/a%0Ab')).toBe('https://evil.example/ab');
        expect(atyReadableUrl('https://evil.example/a%E2%80%AEb')).toBe('https://evil.example/ab');
        expect(atyReadableUrl('https://site.example/a&b')).toBe('https://site.example/a&amp;b');
    });

});
