/** Global toast state (module-level runes). Port of toast() from app.js. */

let message = $state('');
let kind = $state<'ok' | 'err'>('ok');
let visible = $state(false);
let timer: ReturnType<typeof setTimeout> | undefined;

export const toastState = {
	get message() {
		return message;
	},
	get kind() {
		return kind;
	},
	get visible() {
		return visible;
	}
};

export function toast(msg: string, k: 'ok' | 'err' = 'ok'): void {
	message = msg;
	kind = k;
	visible = true;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		visible = false;
	}, k === 'err' ? 6500 : 2800);
}
