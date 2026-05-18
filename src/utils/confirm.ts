import readline from 'readline';

// bash 工具在执行危险命令前调用，等待用户明确输入 y 确认
// 创建临时 rl 实例，不影响外层 CLI 的 readline
export async function confirmFromUser(command: string): Promise<boolean> {
	console.log('\n\x1b[33m⚠️  检测到潜在危险命令：\x1b[0m');
	console.log(`   \x1b[90m${command}\x1b[0m`);

	return confirmQuestion('\n确认执行? (y/N) ');
}

export async function confirmQuestion(prompt: string): Promise<boolean> {
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
			}
			resolve(answer.trim().toLowerCase() === 'y');
		});
	});
}
