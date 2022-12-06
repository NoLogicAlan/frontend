import { findComponents, getUiPackageDirectory, toStoryFile } from './common.mjs';
import { stat, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const components = await findComponents();
const storyFiles = components.map(toStoryFile);

const rootPath = getUiPackageDirectory();

const imports = [];
for (const file of storyFiles) {
    try {
        await stat(file);

        const importPath = file.replace(rootPath, '@revolt/ui').replace('.tsx', '');
        const cn = file.split(sep).pop().replace('.stories.tsx', '');
        imports.push([cn, `import ${cn} from '${importPath}';`]);
    } catch (err) {}
}

const ComponentList = imports.map(x => x[0]);

const OUTPUT = [
    "// This file is auto-generated by generate.mjs!",
    "import type { ComponentStory } from '@revolt/ui/components/stories';",
    "import type { Component } from 'solid-js';",
    imports.map(x => x[1]).join('\n'),
    `export default {${ComponentList.join(', ')}} as Record<string, ComponentStory<Component>>;`]
.join('\n');

const SHOWCASE_DIR = resolve(import.meta.url.substring('file://'.length), '..', '..');

writeFile(resolve(SHOWCASE_DIR, 'src', 'stories.ts'), OUTPUT);
writeFile(resolve(SHOWCASE_DIR, 'componentData.ts'), `export default [${ComponentList.map(x => `"${x}"`).join('\n')}];`);
