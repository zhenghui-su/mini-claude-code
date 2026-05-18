import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listFiles } from '../../src/tools/list-files';
import { search } from '../../src/tools/search';

let previousCwd: string;
let tempDir: string;

beforeEach(async () => {
	previousCwd = process.cwd();
	tempDir = await mkdtemp(join(tmpdir(), 'mini-agent-explore-'));
	process.chdir(tempDir);
	await mkdir('src', { recursive: true });
	await writeFile('src/index.ts', 'const target = 1;\n');
	await writeFile('README.md', 'hello target\n');
});

afterEach(async () => {
	process.chdir(previousCwd);
	await rm(tempDir, { recursive: true, force: true });
});

test('listFiles returns project-relative entries', async () => {
	const result = await listFiles({ path: '.', depth: 1 });

	expect(result.ok).toBe(true);
	expect(result.data).toMatchObject({
		entries: expect.arrayContaining(['README.md', 'src/', 'src/index.ts']),
	});
});

test('search finds text matches with an optional glob', async () => {
	const result = await search({
		query: 'target',
		glob: 'src/**/*.ts',
	});

	expect(result.ok).toBe(true);
	expect(result.data).toMatchObject({
		matches: [{ path: 'src/index.ts', line: 1, text: 'const target = 1;' }],
	});
});
