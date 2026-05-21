import readline from 'readline';
import {
	getDefaultModelId,
	getModelBaseURL,
	hasModelCredential,
	listStoredModelProfileIds,
	listModelProfiles,
	type ModelProfile,
	type ModelProviderKind,
} from '../agent/provider';
import { displayWidth, truncateByDisplayWidth } from './format';
import { theme } from './theme';

type ModelPickerItem =
	| { type: 'model'; profile: ModelProfile }
	| { type: 'add' };

interface ProviderPickerOption {
	kind: ModelProviderKind;
	label: string;
	detail: string;
}

interface ProviderPickerGroup {
	title: string;
	options: ProviderPickerOption[];
}

export type ModelPickerResult =
	| { type: 'use'; profile: ModelProfile }
	| { type: 'add' }
	| { type: 'edit'; profile: ModelProfile }
	| { type: 'delete'; profile: ModelProfile }
	| { type: 'set-default'; profile: ModelProfile };

export type ModelProviderPickerResult = {
	type: 'select';
	provider: ModelProviderKind;
};

let isModelScreenActive = false;

const MODEL_PROVIDER_GROUPS: ProviderPickerGroup[] = [
	{
		title: '官方',
		options: [
			{
				kind: 'deepseek',
				label: 'DeepSeek 官方',
				detail: 'DeepSeek API',
			},
			{
				kind: 'openai',
				label: 'OpenAI 官方',
				detail: 'OpenAI API',
			},
			{
				kind: 'anthropic',
				label: 'Anthropic 官方',
				detail: 'Anthropic API',
			},
		],
	},
	{
		title: '第三方',
		options: [
			{
				kind: 'openai-compatible',
				label: 'OpenAI 兼容格式',
				detail: 'OpenAI-compatible endpoint',
			},
			{
				kind: 'anthropic-compatible',
				label: 'Anthropic 兼容格式',
				detail: 'Anthropic-compatible endpoint',
			},
		],
	},
];

export async function chooseModel(
	activeModelId: string,
): Promise<ModelPickerResult | undefined> {
	const profiles = await listModelProfiles();
	const editableModelIds = await listStoredModelProfileIds();
	const defaultModelId = await getDefaultModelId();
	let selectedIndex = getInitialModelIndex(profiles, activeModelId);
	let message: string | undefined;

	return new Promise((resolve) => {
		const finish = (result: ModelPickerResult | undefined) => {
			process.stdin.off('keypress', onKeypress);
			exitModelScreen();
			resolve(result);
		};

		const onKeypress = (_char: string | undefined, key: readline.Key) => {
			const items = getModelPickerItems(profiles);
			const selectedItem = items[selectedIndex];
			if (key?.ctrl && key.name === 'c') {
				finish(undefined);
				return;
			}
			if (key?.name === 'escape' || key?.name === 'q') {
				finish(undefined);
				return;
			}
			if (key?.name === 'return') {
				if (!selectedItem) return;
				if (selectedItem.type === 'add') {
					finish({ type: 'add' });
					return;
				}
				finish({ type: 'use', profile: selectedItem.profile });
				return;
			}
			if (key?.name === 'e') {
				if (selectedItem?.type !== 'model') return;
				if (!editableModelIds.has(selectedItem.profile.id)) {
					message = '内置模型不能在这里修改，请调整环境变量或新增自定义模型';
					renderModelPicker(
						profiles,
						activeModelId,
						selectedIndex,
						editableModelIds,
						defaultModelId,
						message,
					);
					return;
				}
				finish({ type: 'edit', profile: selectedItem.profile });
				return;
			}
			if (key?.name === 'd') {
				if (selectedItem?.type !== 'model') return;
				if (!editableModelIds.has(selectedItem.profile.id)) {
					message = '内置模型不能在这里删除，请调整环境变量';
					renderModelPicker(
						profiles,
						activeModelId,
						selectedIndex,
						editableModelIds,
						defaultModelId,
						message,
					);
					return;
				}
				finish({ type: 'delete', profile: selectedItem.profile });
				return;
			}
			if (key?.name === 's') {
				if (selectedItem?.type !== 'model') return;
				finish({ type: 'set-default', profile: selectedItem.profile });
				return;
			}
			if (key?.name === 'up') {
				message = undefined;
				selectedIndex = (selectedIndex - 1 + items.length) % items.length;
				renderModelPicker(
					profiles,
					activeModelId,
					selectedIndex,
					editableModelIds,
					defaultModelId,
				);
				return;
			}
			if (key?.name === 'down') {
				message = undefined;
				selectedIndex = (selectedIndex + 1) % items.length;
				renderModelPicker(
					profiles,
					activeModelId,
					selectedIndex,
					editableModelIds,
					defaultModelId,
				);
			}
		};

		process.stdin.on('keypress', onKeypress);
		enterModelScreen();
		renderModelPicker(
			profiles,
			activeModelId,
			selectedIndex,
			editableModelIds,
			defaultModelId,
		);
	});
}

export async function chooseModelProvider(
	defaultProvider: ModelProviderKind = 'openai-compatible',
): Promise<ModelProviderPickerResult | undefined> {
	const options = getProviderPickerOptions();
	let selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.kind === defaultProvider),
	);

	return new Promise((resolve) => {
		const finish = (result: ModelProviderPickerResult | undefined) => {
			process.stdin.off('keypress', onKeypress);
			exitModelScreen();
			resolve(result);
		};

		const onKeypress = (_char: string | undefined, key: readline.Key) => {
			if (key?.ctrl && key.name === 'c') {
				finish(undefined);
				return;
			}
			if (key?.name === 'escape' || key?.name === 'q') {
				finish(undefined);
				return;
			}
			if (key?.name === 'return') {
				const option = options[selectedIndex];
				if (option) finish({ type: 'select', provider: option.kind });
				return;
			}
			if (key?.name === 'up' || key?.name === 'left') {
				selectedIndex = normalizeIndex(selectedIndex - 1, options.length);
				renderModelProviderPicker(selectedIndex);
				return;
			}
			if (key?.name === 'down' || key?.name === 'right') {
				selectedIndex = normalizeIndex(selectedIndex + 1, options.length);
				renderModelProviderPicker(selectedIndex);
			}
		};

		process.stdin.on('keypress', onKeypress);
		enterModelScreen();
		renderModelProviderPicker(selectedIndex);
	});
}

export function renderModelPickerLines(
	profiles: ModelProfile[],
	activeModelId: string,
	selectedIndex: number,
	width: number,
	colors = false,
	editableModelIds: ReadonlySet<string> = new Set(),
	defaultModelId?: string,
	message?: string,
): string[] {
	const maxWidth = Math.max(40, width);
	const items = getModelPickerItems(profiles);
	const selected = normalizeIndex(selectedIndex, items.length);
	const lines = [
		style('选择模型', 'title', colors, maxWidth),
		style(
			'↑/↓ 选择，Enter 切换/新增，s 默认，e 修改，d 删除，q 取消',
			'muted',
			colors,
			maxWidth,
		),
		...items.map((item, index) =>
			renderModelPickerItem(item, {
				activeModelId,
				editable:
					item.type === 'model' && editableModelIds.has(item.profile.id),
				default: item.type === 'model' && item.profile.id === defaultModelId,
				selected: index === selected,
				width: maxWidth,
				colors,
			}),
		),
		...(message ? [style(message, 'warning', colors, maxWidth)] : []),
	];

	return lines;
}

export function renderModelProviderPickerLines(
	selectedIndex: number,
	width: number,
	colors = false,
): string[] {
	const maxWidth = Math.max(40, width);
	const selected = normalizeIndex(
		selectedIndex,
		getProviderPickerOptions().length,
	);
	const lines = [
		style('选择接口格式', 'title', colors, maxWidth),
		style('方向键选择，Enter 确认，Esc 取消', 'muted', colors, maxWidth),
	];
	let optionIndex = 0;

	for (const group of MODEL_PROVIDER_GROUPS) {
		lines.push(style(group.title, 'muted', colors, maxWidth));
		for (const option of group.options) {
			lines.push(
				renderProviderPickerOption(option, {
					selected: optionIndex === selected,
					width: maxWidth,
					colors,
				}),
			);
			optionIndex += 1;
		}
	}

	return lines;
}

function renderModelPicker(
	profiles: ModelProfile[],
	activeModelId: string,
	selectedIndex: number,
	editableModelIds: ReadonlySet<string> = new Set(),
	defaultModelId?: string,
	message?: string,
) {
	const maxWidth = Math.max(40, (process.stdout.columns ?? 80) - 1);
	const lines = renderModelPickerLines(
		profiles,
		activeModelId,
		selectedIndex,
		maxWidth,
		true,
		editableModelIds,
		defaultModelId,
		message,
	);

	if (process.stdout.isTTY) {
		process.stdout.write('\x1b[H\x1b[2J');
	}
	process.stdout.write(lines.join('\n'));
}

function renderModelProviderPicker(selectedIndex: number) {
	const maxWidth = Math.max(40, (process.stdout.columns ?? 80) - 1);
	const lines = renderModelProviderPickerLines(selectedIndex, maxWidth, true);

	if (process.stdout.isTTY) {
		process.stdout.write('\x1b[H\x1b[2J');
	}
	process.stdout.write(lines.join('\n'));
}

function renderModelPickerItem(
	item: ModelPickerItem,
	options: {
		activeModelId: string;
		editable: boolean;
		default: boolean;
		selected: boolean;
		width: number;
		colors: boolean;
	},
): string {
	if (item.type === 'add') {
		return style(
			`${options.selected ? '›' : ' '} + 新增模型`,
			options.selected ? 'selected' : 'normal',
			options.colors,
			options.width,
		);
	}

	const profile = item.profile;
	const active = profile.id === options.activeModelId ? '*' : ' ';
	const marker = options.selected ? '›' : ' ';
	const credential = hasModelCredential(profile) ? 'key 已配置' : 'key 缺失';
	const baseURL = getModelBaseURL(profile) ?? '官方默认';
	const source = options.editable ? '自定义' : '内置';
	const prefix = `${marker} ${active} ${profile.id}  `;
	const defaultMark = options.default ? '  默认' : '';
	const details = `${profile.provider}/${profile.modelId}  ${baseURL}  ${credential}  ${source}${defaultMark}`;
	const available = Math.max(8, options.width - displayWidth(prefix));
	const line = `${prefix}${truncateByDisplayWidth(details, available)}`;

	return style(
		line,
		options.selected
			? 'selected'
			: profile.id === options.activeModelId
				? 'active'
				: 'normal',
		options.colors,
		options.width,
	);
}

function renderProviderPickerOption(
	option: ProviderPickerOption,
	options: {
		selected: boolean;
		width: number;
		colors: boolean;
	},
): string {
	const marker = options.selected ? '›' : ' ';
	const prefix = `${marker} ${option.label}  `;
	const available = Math.max(8, options.width - displayWidth(prefix));
	const line = `${prefix}${truncateByDisplayWidth(option.detail, available)}`;

	return style(
		line,
		options.selected ? 'selected' : 'normal',
		options.colors,
		options.width,
	);
}

function getModelPickerItems(profiles: ModelProfile[]): ModelPickerItem[] {
	return [
		...profiles.map((profile): ModelPickerItem => ({ type: 'model', profile })),
		{ type: 'add' },
	];
}

function getProviderPickerOptions(): ProviderPickerOption[] {
	return MODEL_PROVIDER_GROUPS.flatMap((group) => group.options);
}

function getInitialModelIndex(
	profiles: ModelProfile[],
	activeModelId: string,
): number {
	const index = profiles.findIndex((profile) => profile.id === activeModelId);
	return index >= 0 ? index : 0;
}

function normalizeIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	return ((index % length) + length) % length;
}

function style(
	text: string,
	kind: 'title' | 'muted' | 'selected' | 'active' | 'warning' | 'normal',
	colors: boolean,
	width: number,
): string {
	const clipped = truncateByDisplayWidth(text, width);
	if (!colors) return clipped;

	switch (kind) {
		case 'title':
			return theme.brand(clipped);
		case 'muted':
			return theme.muted(clipped);
		case 'selected':
			return theme.commandSelected(clipped);
		case 'active':
			return theme.success(clipped);
		case 'warning':
			return theme.warning(clipped);
		case 'normal':
			return clipped;
		default:
			return clipped;
	}
}

function enterModelScreen() {
	if (!process.stdout.isTTY || isModelScreenActive) return;

	process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
	isModelScreenActive = true;
}

function exitModelScreen() {
	if (!process.stdout.isTTY || !isModelScreenActive) return;

	process.stdout.write('\x1b[?25h\x1b[?1049l');
	isModelScreenActive = false;
}
