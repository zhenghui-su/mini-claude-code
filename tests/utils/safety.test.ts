import { expect, test } from 'bun:test';
import { detectDanger, isSensitivePath, resolveSafePath } from '../../src/utils/safety';

test('resolveSafePath blocks paths outside cwd', () => {
	expect(() => resolveSafePath('../outside.txt')).toThrow('路径越界');
});

test('detectDanger classifies safe, confirm and block commands', () => {
	expect(detectDanger('ls src')).toBe('safe');
	expect(detectDanger('rm -rf dist')).toBe('confirm');
	expect(detectDanger('rm -rf /')).toBe('block');
});

test('isSensitivePath treats stored model credentials as sensitive', () => {
	expect(isSensitivePath('.mini-claude/models.json')).toBe(true);
});
