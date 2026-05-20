import readline from 'readline';
import { formatDuration } from './format';

export class WorkingIndicator {
	private readonly startedAt = Date.now();
	private readonly frames = ['|', '/', '-', '\\'];
	private timer: Timer | undefined;
	private frameIndex = 0;

	start() {
		if (!process.stdout.isTTY || this.timer) return;
		this.render();
		this.timer = setInterval(() => this.render(), 120);
	}

	pause() {
		if (!process.stdout.isTTY) return;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.clearLine();
	}

	resume() {
		if (!process.stdout.isTTY || this.timer) return;
		this.render();
		this.timer = setInterval(() => this.render(), 120);
	}

	stop(): number {
		this.pause();
		return Date.now() - this.startedAt;
	}

	private render() {
		this.clearLine();
		const frame = this.frames[this.frameIndex % this.frames.length];
		this.frameIndex++;
		process.stdout.write(
			`\x1b[90m${frame} Working ${formatDuration(Date.now() - this.startedAt)}\x1b[0m`,
		);
	}

	private clearLine() {
		readline.clearLine(process.stdout, 0);
		readline.cursorTo(process.stdout, 0);
	}
}
