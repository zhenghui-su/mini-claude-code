import readline from 'readline';

// bash 工具在执行危险命令前调用，等待用户明确输入 y 确认
// 创建临时 rl 实例，不影响外层 CLI 的 readline
export async function confirmFromUser(command: string): Promise<boolean> {
	console.log('\n\x1b[33m⚠️  检测到潜在危险命令：\x1b[0m');
	console.log(`   \x1b[90m${command}\x1b[0m`);

	return confirmQuestion('\n确认执行? (y/N) ');
}

export async function confirmQuestion(prompt: string): Promise<boolean> {
	const answer = await askQuestion(prompt);
	return answer.trim().toLowerCase() === 'y';
}

export async function askQuestion(prompt: string): Promise<string> {
	const wasRaw = process.stdin.isTTY && process.stdin.isRaw;
	if (wasRaw) {
		process.stdin.setRawMode(false);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			rl.close();
			if (wasRaw) {
				process.stdin.setRawMode(true);
				process.stdin.resume();
			}
			resolve(answer);
		});
	});
}

export type KeyedQuestionResult =
	| { type: 'submit'; value: string }
	| { type: 'back'; value: string }
	| { type: 'cancel'; value: string }
	| { type: 'clear'; value: string };

interface KeyedQuestionOptions {
	initialValue?: string;
	allowClear?: boolean;
}

export async function askKeyedQuestion(
	prompt: string,
	options: KeyedQuestionOptions = {},
): Promise<KeyedQuestionResult> {
	if (!process.stdin.isTTY) {
		const value = await askQuestion(prompt);
		if (value === ':back') return { type: 'back', value };
		if (value === ':cancel' || value === ':q') return { type: 'cancel', value };
		if (value === ':clear' && options.allowClear) return { type: 'clear', value: '' };
		return { type: 'submit', value };
	}

	readline.emitKeypressEvents(process.stdin);
	const wasRaw = process.stdin.isRaw;
	if (!wasRaw) {
		process.stdin.setRawMode(true);
	}
	process.stdin.resume();

	let value = options.initialValue ?? '';

	return new Promise((resolve) => {
		const render = () => {
			readline.cursorTo(process.stdout, 0);
			readline.clearLine(process.stdout, 0);
			process.stdout.write(`${prompt}${value}`);
		};

		const finish = (result: KeyedQuestionResult) => {
			process.stdin.off('keypress', onKeypress);
			if (!wasRaw) {
				process.stdin.setRawMode(false);
			}
			process.stdin.resume();
			process.stdout.write('\n');
			resolve(result);
		};

		const onKeypress = (char: string | undefined, key: readline.Key) => {
			if (key?.ctrl && key.name === 'c') {
				finish({ type: 'cancel', value });
				return;
			}
			if (key?.name === 'escape') {
				finish({ type: 'cancel', value });
				return;
			}
			if (key?.name === 'left') {
				finish({ type: 'back', value });
				return;
			}
			if (key?.name === 'right' || key?.name === 'return') {
				finish({ type: 'submit', value });
				return;
			}
			if (key?.ctrl && key.name === 'u') {
				if (!value && options.allowClear) {
					finish({ type: 'clear', value: '' });
					return;
				}
				value = '';
				render();
				return;
			}
			if (key?.name === 'backspace') {
				value = Array.from(value).slice(0, -1).join('');
				render();
				return;
			}
			if (char && !key?.ctrl && !key?.meta) {
				value += char;
				render();
			}
		};

		process.stdin.on('keypress', onKeypress);
		render();
	});
}
