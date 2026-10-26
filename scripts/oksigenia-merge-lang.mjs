// Merge Oksigenia's own string translations into the built language files.
// Runs after scripts/update_langpacks.sh has populated src/assets/lang/<lang>.json.
// Only languages that were actually built get merged; everything else falls back to English.
import fs from 'fs';
import path from 'path';

const langDir = 'src/assets/lang';
const customDir = 'oksigenia-lang';

if (!fs.existsSync(customDir)) {
    console.log('No oksigenia-lang directory, nothing to merge.');
    process.exit(0);
}

let merged = 0;
for (const file of fs.readdirSync(customDir)) {
    if (!file.endsWith('.json')) {
        continue;
    }
    const target = path.join(langDir, file);
    if (!fs.existsSync(target)) {
        // That language was not built (not in moodle.config.json); skip it.
        continue;
    }
    const base = JSON.parse(fs.readFileSync(target, 'utf8'));
    const overrides = JSON.parse(fs.readFileSync(path.join(customDir, file), 'utf8'));
    Object.assign(base, overrides);
    fs.writeFileSync(target, JSON.stringify(base, null, 4) + '\n');
    console.log('Merged Oksigenia strings into', file, '(' + Object.keys(overrides).length + ' keys)');
    merged++;
}
console.log('Done. Merged', merged, 'language file(s).');
