import { expect, test } from 'bun:test';
import { truncateOutput } from '../../src/utils/truncate';

test('truncateOutput keeps short output unchanged', () => {
	expect(truncateOutput('bash', 'short')).toBe('short');
});

test('truncateOutput adds a structured hint for long output', () => {
	const output = truncateOutput('read_file', 'x'.repeat(8_001));

	expect(output).toContain('<system_hint type="tool_output_omitted"');
	expect(output).toContain('tool="read_file"');
});
