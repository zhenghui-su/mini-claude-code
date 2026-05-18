import {
	generateText,
	stepCountIs,
	type ModelMessage,
	type LanguageModelUsage,
	type TypedToolCall,
	type TypedToolResult,
} from 'ai';
import { model } from './provider';
import { assembleSystemPrompt } from './prompt';
import { TOOLS } from '../tools';
import { getToolResultMessage } from '../tools/result';

const MAX_AGENT_STEPS = 20;

export interface RunResult {
	text: string;
	responseMessages: ModelMessage[];
	usage: LanguageModelUsage;
	stepCount: number;
}

interface AgentLoopOptions {
	beforeStepLog?: () => void;
	afterStepLog?: () => void;
}

export async function createExecutionPlan(
	question: string,
	history: ModelMessage[],
	runtimeHints: string[] = [],
): Promise<string> {
	const system = await assembleSystemPrompt([
		...runtimeHints,
		[
			'[计划模式]',
			'本轮只制定执行计划，不要调用工具，不要修改文件，不要执行命令。',
			'计划要简短、具体，说明会读取什么、可能修改什么、如何验证。',
		].join('\n'),
	]);

	const { text } = await generateText({
		model,
		system,
		messages: [
			...history,
			{
				role: 'user',
				content: `请先为这个任务制定执行计划，等待用户确认后再执行：\n\n${question}`,
			},
		],
	});

	return text;
}

// Agent 主要循环
// 封装最大轮次ReAct防止死循环
export async function agentLoop(
	question: string,
	history: ModelMessage[],
	runtimeHints: string[] = [],
	options: AgentLoopOptions = {},
): Promise<RunResult> {
	const system = await assembleSystemPrompt(runtimeHints);

	// 将用户问题追加到 history 中
	const messages: ModelMessage[] = [
		...history,
		{ role: 'user', content: question },
	];

	const result = await generateText({
		model,
		system,
		messages,
		tools: TOOLS,
		stopWhen: stepCountIs(MAX_AGENT_STEPS),
		// 每步完成后的回调: 打印执行过程
		// 最后一步（无工具调用、finishReason=stop）不打印，由外层统一输出最终结果
		onStepFinish: ({ text, toolCalls, toolResults, finishReason }) => {
			const isFinalStep =
				finishReason === 'stop' &&
				toolCalls.length === 0 &&
				toolResults.length === 0;
			const hasVisibleActivity =
				text.trim().length > 0 ||
				toolCalls.length > 0 ||
				toolResults.length > 0;
			if (!isFinalStep && hasVisibleActivity) {
				options.beforeStepLog?.();
				printStep({ text, toolCalls, toolResults, finishReason });
				options.afterStepLog?.();
			}
		},
	});

	// steps 包含所有中间步骤, 打印总步数
	const stepCount = result.steps.length;
	if (stepCount > 1) {
		options.beforeStepLog?.();
		console.log(`\n\x1b[90m[共执行 ${stepCount} 步]\x1b[0m\n`);
	}

	return {
		text: result.text,
		responseMessages: result.response.messages as ModelMessage[],
		usage: result.usage,
		stepCount,
	};
}
interface StepInfo {
	text: string;
	toolCalls: TypedToolCall<typeof TOOLS>[];
	toolResults: TypedToolResult<typeof TOOLS>[];
	finishReason: string;
}

let stepCounter = 0;

function printStep({ text, toolCalls, toolResults }: StepInfo) {
	stepCounter++;
	console.log(
		`\n\x1b[36m── Step ${stepCounter} ──────────────────────────────────\x1b[0m`,
	);

	// LLM 思考文本（如果有）
	if (text.trim()) {
		console.log(`\x1b[37m${text.trim()}\x1b[0m`);
	}

	// 工具调用
	for (const call of toolCalls) {
		// 工具调用：一行，参数压缩成单行 JSON，超 120 字符截断
		const input = 'input' in call ? call.input : undefined;
		const argsPreview = formatPreview(input);
		console.log(
			`\n\x1b[32m🔧 ${call.toolName}\x1b[0m \x1b[90m${argsPreview}\x1b[0m`,
		);
	}

	for (const result of toolResults) {
		const outputPreview = formatPreview(result.output);
		console.log(
			`\x1b[90m↳ ${result.toolName} 结果 ${outputPreview}\x1b[0m`,
		);
	}
}

function formatPreview(value: unknown): string {
	const toolMessage = getToolResultMessage(value);
	if (toolMessage) return compactPreview(toolMessage);

	const text =
		typeof value === 'string' ? value : JSON.stringify(value ?? {});

	return compactPreview(text);
}

function compactPreview(text: string): string {
	if (text.length <= 120) return text;
	return text.slice(0, 119) + '…';
}

// 重置步骤计数器（每次新对话调用）
export function resetStepCounter() {
	stepCounter = 0;
}
