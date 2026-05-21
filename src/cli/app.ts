import readline from 'readline';
import type { ModelMessage } from 'ai';
import {
	agentLoop,
	createExecutionPlan,
	resetStepCounter,
} from '../agent/loop';
import {
	compactContext,
	createContextSnapshot,
	DEFAULT_CONTEXT_LIMIT,
	recordUsage,
	shouldCompress,
	type CompressionReason,
	type ContextSnapshot,
} from '../agent/context';
import {
	addModelProfile,
	deleteModelProfile,
	hasModelCredential,
	isStoredModelProfile,
	listUsableModelProfiles,
	normalizeModelProfile,
	type ModelProfile,
	type ModelProviderKind,
} from '../agent/provider';
import {
	createSessionName,
	listSessions,
	saveSession,
	summarizeSession,
} from '../agent/session';
import {
	askKeyedQuestion,
	confirmQuestion,
} from '../utils/confirm';
import packageJson from '../../package.json';
import {
	displayWidth,
	formatContextReport,
	formatDuration,
	formatSessionTime,
	getContextUsageDisplay,
	renderHudLine,
	renderTerminalMarkdown,
	truncateByDisplayWidth,
} from './format';
import { printCliHelp, printHelp } from './help';
import { renderInputBox } from './input-box';
import { chooseModel, chooseModelProvider } from './model';
import { chooseSession, printSessionTranscript } from './resume';
import {
	completeSlashInput,
	getSlashMatches,
	moveSlashSelection,
	normalizeSlashSelection,
	parsePlanInput,
} from './slash';
import { theme } from './theme';
import { WorkingIndicator } from './working-indicator';

export async function runCli() {
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	const app = new CliApp();
	process.stdin.on('keypress', app.handleKeypress);
	process.stdout.on('resize', app.handleResize);
	await app.bootstrap();
}

type ModelFormResult = 'saved' | 'cancel' | 'back';
type ModelFormStep =
	| 'provider'
	| 'modelId'
	| 'id'
	| 'baseURL'
	| 'apiKey'
	| 'contextLimit';
type ModelFieldResult =
	| { type: 'submit'; value: string }
	| { type: 'clear' }
	| { type: 'back' }
	| { type: 'cancel' };

interface ModelFormState {
	provider: ModelProviderKind;
	modelId: string;
	id: string;
	baseURL: string;
	apiKey: string;
	contextLimit: string;
}

class CliApp {
	// 维护跨轮对话的消息历史（不含系统提示词，generateText 单独传 system）
	private history: ModelMessage[] = [];
	// 分层上下文状态（模型、token 用量、压缩摘要、工作记忆等）
	private context: ContextSnapshot = createContextSnapshot();
	private currentSessionName = createSessionName();
	private inputLine = '';
	private renderedInputLineWidths: number[] = [];
	private renderedInputCursorLine = 0;
	private renderedInputCursorColumn = 0;
	private isInputActive = false;
	private isClosed = false;
	private selectedSlashIndex = 0;

	handleKeypress = (char: string | undefined, key: readline.Key) => {
		if (!this.isInputActive || this.isClosed) return;

		if (key?.ctrl && key.name === 'c') {
			this.closeCli();
			return;
		}

		if (key?.name === 'return') {
			void this.submitInput();
			return;
		}

		if (this.isSlashPickerOpen() && key?.name === 'up') {
			this.selectedSlashIndex = moveSlashSelection(
				this.inputLine,
				this.selectedSlashIndex,
				-1,
			);
			this.renderInput();
			return;
		}

		if (this.isSlashPickerOpen() && key?.name === 'down') {
			this.selectedSlashIndex = moveSlashSelection(
				this.inputLine,
				this.selectedSlashIndex,
				1,
			);
			this.renderInput();
			return;
		}

		if (this.isSlashPickerOpen() && key?.name === 'tab') {
			const completed = completeSlashInput(
				this.inputLine,
				this.selectedSlashIndex,
			);
			if (completed) {
				this.inputLine = completed;
				this.selectedSlashIndex = 0;
				this.renderInput();
			}
			return;
		}

		if (key?.name === 'backspace') {
			this.inputLine = this.inputLine.slice(0, -1);
			this.selectedSlashIndex = 0;
			this.renderInput();
			return;
		}

		if (key?.ctrl && key.name === 'u') {
			this.inputLine = '';
			this.selectedSlashIndex = 0;
			this.renderInput();
			return;
		}

		if (char && !key?.ctrl && !key?.meta) {
			this.inputLine += char;
			this.selectedSlashIndex = 0;
			this.renderInput();
		}
	};

	handleResize = () => {
		if (!this.isInputActive || this.isClosed) return;
		this.renderInput();
	};

	async bootstrap() {
		const command = process.argv[2];
		if (command === '-V' || command === '--version') {
			console.log(packageJson.version);
			this.closeWithoutMessage();
			return;
		}
		if (command === '-h' || command === '--help') {
			printCliHelp();
			this.closeWithoutMessage();
			return;
		}

		console.log(
			`${theme.brand('mini-claude-code')} ${theme.muted(`v${packageJson.version} — 输入 /help 查看帮助`)}`,
		);

		if (command === 'resume') {
			const session = await chooseSession();
			if (!session) {
				this.closeWithoutMessage();
				return;
			}

			this.currentSessionName = session.name;
			this.history = session.history;
			this.context = session.context;
			printSessionTranscript(session);
			if (!(await this.ensureUsableModelConfigured())) {
				this.closeWithoutMessage();
				return;
			}
			this.startInput();
			return;
		} else if (command && command !== 'start') {
			console.log(theme.warningStatus(`未知参数: ${command}`));
			console.log('用法：minicc [resume|--help|-V]');
		}

		if (!(await this.ensureUsableModelConfigured())) {
			this.closeWithoutMessage();
			return;
		}
		this.startInput();
	}

	private async handleLine(input: string) {
		const question = input.trim();

		// slash 命令
		if (question === '/exit' || question === '/quit') {
			this.closeCli();
			return;
		}

		if (question === '/reset') {
			this.history = [];
			this.context = createContextSnapshot();
			this.currentSessionName = createSessionName();
			console.log(theme.status('会话已重置'));
			this.startInput();
			return;
		}

		if (question === '/sessions') {
			const sessions = await listSessions();
			if (sessions.length === 0) {
				console.log(theme.status('暂无已保存会话'));
			} else {
				console.log(`\n${theme.brand('已保存会话：')}`);
				for (const session of sessions) {
					const summary = summarizeSession(session);
					console.log(
						`  ${formatSessionTime(summary.updatedAt)}  ${summary.lastReplyPreview}`,
					);
				}
			}
			this.startInput();
			return;
		}

		if (question === '/help') {
			printHelp();
			this.startInput();
			return;
		}

		if (question === '/context') {
			this.printContextDetails();
			this.startInput();
			return;
		}

		if (question === '/model') {
			await this.handleModelCommand();
			this.startInput();
			return;
		}

		if (question === '/compact') {
			try {
				const result = await this.runCompaction('manual');
				console.log(
					theme.status(
						`上下文已压缩：${result.previousMessageCount} 条消息 -> 1 份摘要`,
					),
				);
			} catch (e) {
				console.log(theme.warningStatus(`压缩失败: ${(e as Error).message}`));
			}
			this.startInput();
			return;
		}

		if (!question) {
			this.startInput();
			return;
		}

		const planQuestion = parsePlanInput(question);
		if (
			question === '/plan' ||
			(question.startsWith('/plan ') && !planQuestion)
		) {
			this.startInput();
			return;
		}

		if (question.startsWith('/')) {
			if (question !== '/' && !planQuestion) {
				console.log(theme.warningStatus(`未知命令: ${question}`));
			}
			if (!planQuestion) {
				this.startInput();
				return;
			}
		}

		// ── 执行 Agent Loop ────────────────────────────────────────────────────────
		resetStepCounter();

		const working = new WorkingIndicator();
		working.start();

		try {
			const userQuestion = planQuestion ?? question;
			let executionQuestion = userQuestion;
			if (planQuestion) {
				const plan = await createExecutionPlan(
					userQuestion,
					this.history,
					this.context,
				);
				working.pause();
				console.log(
					`\n${theme.info('── 执行计划 ─────────────────────────────────────')}`,
				);
				console.log(renderTerminalMarkdown(plan));

				const approved = await confirmQuestion('\n按计划执行? (y/N) ');
				if (!approved) {
					working.stop();
					console.log(theme.status('已取消执行'));
					return;
				}

				executionQuestion = [
					userQuestion,
					'',
					'用户已确认以下执行计划，请按计划继续：',
					plan,
				].join('\n');
				working.resume();
			}

			const { text, responseMessages, usage, stepCount } = await agentLoop(
				executionQuestion,
				this.history,
				this.context,
				{
					beforeStepLog: () => working.pause(),
					afterStepLog: () => working.resume(),
				},
			);

			const elapsedMs = working.stop();

			// 将本轮消息（含所有中间工具调用步骤）追加到 history
			this.history.push({ role: 'user', content: userQuestion });
			this.history.push(...responseMessages);
			this.context = recordUsage(this.context, usage);
			await this.saveCurrentSession();

			// 有工具调用（多步）时才打印分隔线，纯文本回答直接输出，避免重复
			if (stepCount > 1) {
				console.log(
					`\n${theme.info('── 最终回答 ─────────────────────────────────────')}`,
				);
			}
			console.log(renderTerminalMarkdown(text));
			console.log(
				`\n${theme.muted(`─ Worked for ${formatDuration(elapsedMs)} ──`)}`,
			);

			// ── 上下文压缩检查（基于本轮 prompt tokens 判断）────────────────────────
			if (
				shouldCompress(
					this.context.lastPromptTokens ?? 0,
					this.context.contextLimit,
				)
			) {
				console.log(`\n${theme.warningStatus('上下文接近上限，正在压缩...')}`);
				try {
					const result = await this.runCompaction('threshold');
					console.log(
						theme.status(
							`上下文已自动压缩：${result.previousMessageCount} 条消息 -> 1 份摘要`,
						),
					);
				} catch (e) {
					console.warn(
						theme.warningStatus(`压缩失败: ${(e as Error).message}`),
					);
				}
			}
		} catch (e) {
			working.stop();
			console.error(`\n${theme.errorStatus(`错误: ${(e as Error).message}`)}`);
		} finally {
			this.startInput();
		}
	}

	private async saveCurrentSession() {
		if (this.history.length === 0) return;

		try {
			await saveSession(this.currentSessionName, {
				history: this.history,
				context: this.context,
			});
		} catch (e) {
			console.warn(
				theme.warningStatus(`会话保存失败: ${(e as Error).message}`),
			);
		}
	}

	private async ensureUsableModelConfigured(): Promise<boolean> {
		const usableProfiles = await listUsableModelProfiles();
		if (usableProfiles.length > 0) {
			if (!usableProfiles.some((profile) => profile.id === this.context.modelId)) {
				const profile = usableProfiles[0];
				if (profile) {
					this.context = createContextSnapshot({
						...this.context,
						modelId: profile.id,
						contextLimit: profile.contextLimit,
					});
				}
			}
			return true;
		}

		console.log(theme.warningStatus('未发现可用模型，请先新增模型'));
		const result = await this.addModelInteractively();
		if (result === 'saved') return true;

		console.log(theme.warningStatus('未配置可用模型，无法开始对话'));
		return false;
	}

	private startInput() {
		if (this.isClosed) return;
		this.isInputActive = true;
		this.inputLine = '';
		this.selectedSlashIndex = 0;
		this.renderInput();
	}

	private async submitInput() {
		if (!this.isInputActive) return;

		const submitted = this.inputLine;
		if (!submitted.trim()) {
			this.inputLine = '';
			this.renderInput();
			return;
		}

		this.clearInputArea();
		process.stdout.write(`${renderInputBox(submitted).text}\n`);
		this.inputLine = '';
		this.selectedSlashIndex = 0;
		this.isInputActive = false;
		await this.handleLine(submitted);
	}

	private renderInput() {
		if (!process.stdout.isTTY) return;

		this.clearInputArea();
		process.stdout.write('\x1b[?25h');
		const matches = getSlashMatches(this.inputLine);
		this.selectedSlashIndex = normalizeSlashSelection(
			this.inputLine,
			this.selectedSlashIndex,
		);
		const inputBox = renderInputBox(this.inputLine);
		const isSlashMode = this.isSlashMode();
		const extraLines = isSlashMode
			? matches.map((command, index) =>
					this.formatSlashMatchLine(
						command.name,
						command.description,
						index === this.selectedSlashIndex,
					),
				)
			: [this.buildHudLine()];
		const lines = [...inputBox.lines, ...extraLines];
		const lineWidths = lines.map(visibleTextWidth);

		process.stdout.write(lines.join('\n'));
		this.renderedInputLineWidths = lineWidths;
		this.renderedInputCursorLine = inputBox.cursorLineIndex;
		this.renderedInputCursorColumn = inputBox.cursorColumn;

		const layout = measureRenderLayout(
			lineWidths,
			inputBox.cursorLineIndex,
			inputBox.cursorColumn,
			process.stdout.columns ?? 80,
		);
		const linesBelowInput = layout.totalRows - 1 - layout.cursorRow;
		if (linesBelowInput > 0) {
			readline.moveCursor(process.stdout, 0, -linesBelowInput);
		}
		readline.cursorTo(process.stdout, layout.cursorColumn);
	}

	private isSlashMode(): boolean {
		return this.inputLine.trimStart().startsWith('/');
	}

	private isSlashPickerOpen(): boolean {
		return getSlashMatches(this.inputLine).length > 0;
	}

	private formatSlashMatchLine(
		name: string,
		description: string,
		selected: boolean,
	): string {
		const maxWidth = Math.max(1, (process.stdout.columns ?? 80) - 1);
		const line = truncateByDisplayWidth(
			`${name.padEnd(16)} ${description}`,
			maxWidth,
		);
		return selected ? theme.commandSelected(line) : theme.muted(line);
	}

	private buildHudLine(): string {
		return renderHudLine({
			modelId: this.context.modelId,
			cwd: process.cwd(),
			usage: this.getContextUsage(),
			width: process.stdout.columns ?? 80,
		});
	}

	private getContextUsage() {
		return getContextUsageDisplay(
			this.context.lastPromptTokens,
			this.context.contextLimit,
		);
	}

	private async handleModelCommand() {
		try {
			while (true) {
				const result = await chooseModel(this.context.modelId);
				if (!result) {
					console.log(theme.status('已取消模型选择'));
					return;
				}

				if (result.type === 'add') {
					const formResult = await this.addModelInteractively();
					if (formResult === 'back') continue;
					return;
				}

				if (result.type === 'edit') {
					const formResult = await this.editModelInteractively(result.profile);
					if (formResult === 'back') continue;
					return;
				}

				if (result.type === 'delete') {
					await this.deleteModelInteractively(result.profile);
					return;
				}

				await this.switchModel(result.profile);
				return;
			}
		} catch (e) {
			console.log(theme.warningStatus((e as Error).message));
		}
	}

	private async switchModel(profile: ModelProfile) {
		if (!hasModelCredential(profile)) {
			console.log(theme.warningStatus(`模型 ${profile.id} 缺少 API Key`));
			return;
		}

		this.context = createContextSnapshot({
			...this.context,
			modelId: profile.id,
			contextLimit: profile.contextLimit,
		});
		await this.saveCurrentSession();
		console.log(theme.status(`已切换模型：${profile.id}`));
	}

	private async addModelInteractively(
		providerHint?: ModelProviderKind,
	): Promise<ModelFormResult> {
		return this.upsertModelInteractively({
			mode: 'add',
			providerHint,
		});
	}

	private async editModelInteractively(
		profile: ModelProfile,
	): Promise<ModelFormResult> {
		if (!(await isStoredModelProfile(profile.id))) {
			console.log(theme.warningStatus('内置模型不能在这里修改，请调整环境变量'));
			return 'cancel';
		}

		return this.upsertModelInteractively({
			mode: 'edit',
			profile,
		});
	}

	private async upsertModelInteractively(options: {
		mode: 'add' | 'edit';
		providerHint?: ModelProviderKind;
		profile?: ModelProfile;
	}): Promise<ModelFormResult> {
		const existing = options.profile;
		const state: ModelFormState = {
			provider:
				existing?.provider ?? options.providerHint ?? 'openai-compatible',
			modelId: existing?.modelId ?? '',
			id: existing?.id ?? '',
			baseURL: existing?.baseURL ?? '',
			apiKey: existing?.apiKey ?? '',
			contextLimit: String(existing?.contextLimit ?? DEFAULT_CONTEXT_LIMIT),
		};
		let step: ModelFormStep = 'provider';

		console.log(theme.status('← 返回上一步，→ 下一步，Esc 取消，Ctrl+U 清空可选字段'));
		while (true) {
			if (step === 'provider') {
				const provider = await this.askProviderKind(state.provider);
				if (!provider) {
					console.log(theme.status('已取消模型配置'));
					return 'cancel';
				}

				state.provider = provider;
				step = 'modelId';
				continue;
			}

			if (step === 'modelId') {
				const result = await this.askModelField('模型 ID', state.modelId);
				if (result.type === 'cancel') return this.cancelModelConfig();
				if (result.type === 'back') {
					step = 'provider';
					continue;
				}
				if (result.type === 'clear' || !result.value.trim()) {
					console.log(theme.warningStatus('模型 ID 不能为空'));
					continue;
				}
				state.modelId = result.value.trim();
				step = 'id';
				continue;
			}

			if (step === 'id') {
				const defaultId = state.id || `${state.provider}:${state.modelId}`;
				const result = await this.askModelField('模型名称/别名', '', {
					defaultValue: defaultId,
				});
				if (result.type === 'cancel') return this.cancelModelConfig();
				if (result.type === 'back') {
					step = 'modelId';
					continue;
				}
				if (result.type === 'clear') {
					state.id = '';
				} else {
					state.id = result.value.trim() || defaultId;
				}
				step = 'baseURL';
				continue;
			}

			if (step === 'baseURL') {
				const result = await this.askModelField(
					state.provider.endsWith('compatible')
						? 'Base URL'
						: 'Base URL（官方默认可留空）',
					state.baseURL,
					{ allowClear: true },
				);
				if (result.type === 'cancel') return this.cancelModelConfig();
				if (result.type === 'back') {
					step = 'id';
					continue;
				}
				state.baseURL =
					result.type === 'clear' ? '' : result.value.trim();
				if (state.provider.endsWith('compatible') && !state.baseURL) {
					console.log(theme.warningStatus('兼容接口模型必须填写 Base URL'));
					continue;
				}
				step = 'apiKey';
				continue;
			}

			if (step === 'apiKey') {
				const result = await this.askModelField(
					state.provider.endsWith('compatible')
						? 'API Key'
						: 'API Key（留空使用环境变量）',
					state.apiKey,
					{ allowClear: true, maskCurrent: true },
				);
				if (result.type === 'cancel') return this.cancelModelConfig();
				if (result.type === 'back') {
					step = 'baseURL';
					continue;
				}
				state.apiKey = result.type === 'clear' ? '' : result.value.trim();
				if (state.provider.endsWith('compatible') && !state.apiKey) {
					console.log(theme.warningStatus('兼容接口模型必须填写 API Key'));
					continue;
				}
				step = 'contextLimit';
				continue;
			}

			const result = await this.askModelField(
				'上下文上限',
				state.contextLimit || String(DEFAULT_CONTEXT_LIMIT),
			);
			if (result.type === 'cancel') return this.cancelModelConfig();
			if (result.type === 'back') {
				step = 'apiKey';
				continue;
			}
			if (result.type !== 'clear') state.contextLimit = result.value.trim();

			const profile = normalizeModelProfile({
				id: state.id || `${state.provider}:${state.modelId}`,
				provider: state.provider,
				modelId: state.modelId,
				baseURL: state.baseURL,
				apiKey: state.apiKey,
				contextLimit: state.contextLimit
					? Number(state.contextLimit)
					: DEFAULT_CONTEXT_LIMIT,
				createdAt: existing?.createdAt,
			});
			if (!hasModelCredential(profile)) {
				console.log(
					theme.warningStatus('未填写 API Key，且没有可用的对应环境变量'),
				);
				step = 'apiKey';
				continue;
			}

			const saved = await addModelProfile(profile);
			if (existing && existing.id !== saved.id) {
				await deleteModelProfile(existing.id);
			}

			if (options.mode === 'add' || this.context.modelId === existing?.id) {
				this.context = createContextSnapshot({
					...this.context,
					modelId: saved.id,
					contextLimit: saved.contextLimit,
				});
				await this.saveCurrentSession();
			}

			console.log(
				theme.status(
					options.mode === 'add'
						? `已新增并切换模型：${saved.id}`
						: `已修改模型：${saved.id}`,
				),
			);
			return 'saved';
		}
	}

	private async deleteModelInteractively(profile: ModelProfile): Promise<void> {
		if (!(await isStoredModelProfile(profile.id))) {
			console.log(theme.warningStatus('内置模型不能在这里删除，请调整环境变量'));
			return;
		}

		const confirmed = await confirmQuestion(
			`确认删除模型 ${profile.id}? (y/N) `,
		);
		if (!confirmed) {
			console.log(theme.status('已取消删除模型'));
			return;
		}

		const deleted = await deleteModelProfile(profile.id);
		if (!deleted) {
			console.log(theme.warningStatus(`模型不存在：${profile.id}`));
			return;
		}

		if (this.context.modelId === profile.id) {
			const fallback = (await listUsableModelProfiles())[0];
			if (fallback) {
				this.context = createContextSnapshot({
					...this.context,
					modelId: fallback.id,
					contextLimit: fallback.contextLimit,
				});
				await this.saveCurrentSession();
				console.log(
					theme.status(
						`已删除模型：${profile.id}，当前模型已切换为 ${fallback.id}`,
					),
				);
				return;
			}

			console.log(theme.status(`已删除模型：${profile.id}`));
			if (!(await this.ensureUsableModelConfigured())) {
				this.closeWithoutMessage();
			}
			return;
		}

		console.log(theme.status(`已删除模型：${profile.id}`));
	}

	private async askProviderKind(
		providerHint?: ModelProviderKind,
	): Promise<ModelProviderKind | undefined> {
		const result = await chooseModelProvider(providerHint ?? 'openai-compatible');
		if (!result) return undefined;
		return result.provider;
	}

	private async askModelField(
		label: string,
		currentValue: string,
		options: {
			allowClear?: boolean;
			maskCurrent?: boolean;
			defaultValue?: string;
		} = {},
	): Promise<ModelFieldResult> {
		const current = currentValue.trim();
		const defaultDisplay = options.defaultValue?.trim();
		const valueHint = defaultDisplay ? `（默认 ${defaultDisplay}）` : '';
		const prompt = `${label}${valueHint}: `;
		const result = await askKeyedQuestion(prompt, {
			initialValue: options.maskCurrent ? '' : current,
			allowClear: options.allowClear,
		});

		if (result.type === 'cancel') return { type: 'cancel' };
		if (result.type === 'back') return { type: 'back' };
		if (result.type === 'clear') return { type: 'clear' };
		if (options.maskCurrent && !result.value.trim() && current) {
			return { type: 'submit', value: current };
		}
		if (!result.value.trim() && defaultDisplay) {
			return { type: 'submit', value: defaultDisplay };
		}
		return { type: 'submit', value: result.value };
	}

	private cancelModelConfig(): ModelFormResult {
		console.log(theme.status('已取消模型配置'));
		return 'cancel';
	}

	private printContextDetails() {
		console.log('');
		console.log(
			renderTerminalMarkdown(
				formatContextReport(this.context, this.history.length, process.cwd()),
			),
		);
		console.log('');
	}

	private async runCompaction(reason: CompressionReason) {
		const result = await compactContext({
			history: this.history,
			context: this.context,
			reason,
		});
		this.history = result.history;
		this.context = result.context;
		await this.saveCurrentSession();
		return result;
	}

	private clearInputArea() {
		if (!process.stdout.isTTY || this.renderedInputLineWidths.length === 0) return;

		const layout = measureRenderLayout(
			this.renderedInputLineWidths,
			this.renderedInputCursorLine,
			this.renderedInputCursorColumn,
			process.stdout.columns ?? 80,
		);
		if (layout.cursorRow > 0) {
			readline.moveCursor(process.stdout, 0, -layout.cursorRow);
		}
		readline.cursorTo(process.stdout, 0);
		const rowsToClear = layout.totalRows + 4;
		for (let i = 0; i < rowsToClear; i++) {
			readline.clearLine(process.stdout, 0);
			if (i < rowsToClear - 1) {
				readline.moveCursor(process.stdout, 0, 1);
			}
		}
		if (rowsToClear > 1) {
			readline.moveCursor(process.stdout, 0, -(rowsToClear - 1));
		}
		readline.cursorTo(process.stdout, 0);
		this.renderedInputLineWidths = [];
		this.renderedInputCursorLine = 0;
		this.renderedInputCursorColumn = 0;
	}

	private closeCli() {
		if (this.isClosed) return;
		this.isClosed = true;
		this.clearInputArea();
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		console.log(theme.muted('再见！'));
		process.exit(0);
	}

	private closeWithoutMessage() {
		this.isClosed = true;
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.exit(0);
	}
}

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;

function visibleTextWidth(text: string): number {
	return displayWidth(text.replace(ANSI_ESCAPE_REGEX, ''));
}

function measureRenderLayout(
	lineWidths: number[],
	cursorLineIndex: number,
	cursorColumn: number,
	columns: number,
): {
	totalRows: number;
	cursorRow: number;
	cursorColumn: number;
} {
	const safeColumns = Math.max(1, columns);
	const widths = lineWidths.map((width) => Math.max(1, width));
	const rowsPerLine = widths.map((width) =>
		Math.max(1, Math.ceil(width / safeColumns)),
	);
	const safeCursorLineIndex = Math.min(
		Math.max(0, cursorLineIndex),
		Math.max(0, widths.length - 1),
	);
	const cursorLineWidth = widths[safeCursorLineIndex] ?? 1;
	const cursorLineRows = rowsPerLine[safeCursorLineIndex] ?? 1;
	const safeCursorColumn = Math.min(Math.max(0, cursorColumn), cursorLineWidth);
	const cursorRowOffset = Math.min(
		cursorLineRows - 1,
		Math.floor(safeCursorColumn / safeColumns),
	);
	const rowsBeforeCursor = rowsPerLine
		.slice(0, safeCursorLineIndex)
		.reduce((sum, value) => sum + value, 0);
	const totalRows = rowsPerLine.reduce((sum, value) => sum + value, 0);

	return {
		totalRows,
		cursorRow: rowsBeforeCursor + cursorRowOffset,
		cursorColumn: safeCursorColumn % safeColumns,
	};
}
