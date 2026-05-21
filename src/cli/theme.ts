import chalk from 'chalk';

function usageStyle(percent: number) {
	if (percent >= 80) return chalk.bold.redBright;
	if (percent >= 60) return chalk.bold.yellowBright;
	return chalk.bold.greenBright;
}

export const theme = {
	brand: chalk.bold,
	muted: chalk.gray,
	info: chalk.cyanBright,
	warning: chalk.yellowBright,
	error: chalk.redBright,
	success: chalk.greenBright,
	prompt: chalk.blue,
	promptCommand: chalk.blueBright,
	commandSelected: chalk.blueBright,
	hudModelLabel: chalk.bold.cyanBright,
	hudPathLabel: chalk.bold.yellowBright,
	hudContextLabel: chalk.bold.magentaBright,
	hudValue: chalk.rgb(245, 226, 188),
	hudPathValue: chalk.blueBright,
	transcriptLabel: chalk.gray,
	selected: chalk.inverse,
	status(message: string) {
		return chalk.gray(`[${message}]`);
	},
	warningStatus(message: string) {
		return chalk.yellow(`[${message}]`);
	},
	errorStatus(message: string) {
		return chalk.red(`[${message}]`);
	},
	usage(percent: number, text: string) {
		return usageStyle(percent)(text);
	},
};
