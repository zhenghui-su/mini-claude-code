import { expect, test } from 'bun:test';
import type { ModelProfile } from '../../src/agent/provider';
import {
	renderModelPickerLines,
	renderModelProviderPickerLines,
} from '../../src/cli/model';

const profiles: ModelProfile[] = [
	{
		id: 'openai-official',
		provider: 'openai',
		modelId: 'gpt-5.5',
		contextLimit: 128_000,
	},
	{
		id: 'custom-openai',
		provider: 'openai-compatible',
		modelId: 'gpt-custom',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
		contextLimit: 32_000,
	},
];

test('renderModelPickerLines marks selected, active and add rows', () => {
	const lines = renderModelPickerLines(
		profiles,
		'custom-openai',
		1,
		100,
		false,
		new Set(['custom-openai']),
	);

	expect(lines[0]).toBe('选择模型');
	expect(lines[1]).toBe('↑/↓ 选择，Enter 切换/新增，e 修改，d 删除，q 取消');
	expect(lines[2]).toContain('openai-official');
	expect(lines[2]).toContain('内置');
	expect(lines[3]).toContain('› * custom-openai');
	expect(lines[3]).toContain('openai-compatible/gpt-custom');
	expect(lines[3]).toContain('key 已配置');
	expect(lines[3]).toContain('自定义');
	expect(lines[4]).toBe('  + 新增模型');
});

test('renderModelPickerLines can select the add row', () => {
	const lines = renderModelPickerLines(
		profiles,
		'custom-openai',
		2,
		100,
		false,
		new Set(['custom-openai']),
	);

	expect(lines[4]).toBe('› + 新增模型');
});

test('renderModelProviderPickerLines groups official and third-party formats', () => {
	const lines = renderModelProviderPickerLines(3, 100, false);

	expect(lines[1]).toBe('方向键选择，Enter 确认，Esc 取消');
	expect(lines).toContain('官方');
	expect(lines).toContain('第三方');
	expect(lines).toContain('  DeepSeek 官方  DeepSeek API');
	expect(lines).toContain('  OpenAI 官方  OpenAI API');
	expect(lines).toContain('  Anthropic 官方  Anthropic API');
	expect(lines).toContain(
		'› OpenAI 兼容格式  OpenAI-compatible endpoint',
	);
	expect(lines).toContain(
		'  Anthropic 兼容格式  Anthropic-compatible endpoint',
	);
});
