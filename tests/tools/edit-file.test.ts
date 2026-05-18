import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { editFile } from '../../src/tools/edit-file';

let previousCwd: string;
let tempDir: string;

beforeEach(async () => {
	previousCwd = process.cwd();
	tempDir = await mkdtemp(join(tmpdir(), 'mini-agent-edit-'));
	process.chdir(tempDir);
});

afterEach(async () => {
	process.chdir(previousCwd);
	await rm(tempDir, { recursive: true, force: true });
});

test('editFile replaces a unique string', async () => {
	await writeFile('hello.txt', 'hello world\n');

	const result = await editFile({
		path: 'hello.txt',
		old_string: 'world',
		new_string: 'agent',
	});

	expect(result.ok).toBe(true);
	expect(await Bun.file('hello.txt').text()).toBe('hello agent\n');
});

test('editFile rejects duplicate old_string', async () => {
	await writeFile('hello.txt', 'same\nsame\n');

	const result = await editFile({
		path: 'hello.txt',
		old_string: 'same',
		new_string: 'new',
	});

	expect(result.ok).toBe(false);
	expect(result.message).toContain('出现了 2 次');
});
