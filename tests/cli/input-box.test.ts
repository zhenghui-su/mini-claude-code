import { expect, test } from 'bun:test';
import { renderInputBox } from '../../src/cli/input-box';

test('renderInputBox falls back to a plain prompt without terminal colors', () => {
	const box = renderInputBox('你好 /plan', { colors: false, width: 40 });

	expect(box.lines).toEqual(['> 你好 /plan']);
	expect(box.text).toBe('> 你好 /plan');
	expect(box.cursorLineIndex).toBe(0);
	expect(box.cursorColumn).toBe(12);
});

test('renderInputBox creates a colored single-line prompt', () => {
	const box = renderInputBox('hello', { colors: true, width: 36 });

	expect(box.lines).toHaveLength(1);
	expect(box.text).toContain('\x1b[34m> ');
	expect(box.text).toContain('\x1b[37mhello');
	expect(box.text).not.toContain('\x1b[48;');
	expect(box.cursorLineIndex).toBe(0);
	expect(box.cursorColumn).toBe(7);
});

test('renderInputBox adapts to narrow terminal widths', () => {
	const box = renderInputBox('abcdefg', { colors: false, width: 8 });

	expect(box.lines).toEqual(['> abcde…']);
	expect(box.visibleValue).toBe('abcde…');
	expect(box.cursorColumn).toBe(8);
});
