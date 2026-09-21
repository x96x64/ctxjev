import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
function cachePath(cwd) {
    return join(cwd, '.ctxjev', 'preserved-context.json');
}
export async function writePreservedContext(cwd, data) {
    await mkdir(join(cwd, '.ctxjev'), { recursive: true });
    await writeFile(cachePath(cwd), JSON.stringify(data, null, 2), 'utf8');
}
export async function readPreservedContext(cwd) {
    try {
        return JSON.parse(await readFile(cachePath(cwd), 'utf8'));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=preserve.js.map