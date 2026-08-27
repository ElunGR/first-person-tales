/**
 * Cancellable-operation registry mirroring the X-Operation-ID handling in
 * backend/main.py. Each registered operation owns an AbortController; a
 * DELETE /operations/{id} aborts it (the route answers 499), and already
 * cancelled IDs pre-abort late registrations.
 */

const CANCELLED_DISCARD_SECONDS = 30;

const activeOperations = new Map<string, AbortController>();
const cancelledOperations = new Set<string>();

export function registerOperation(operationId: string | null): AbortController | null {
	if (!operationId) return null;
	const controller = new AbortController();
	activeOperations.set(operationId, controller);
	if (cancelledOperations.has(operationId)) {
		controller.abort();
	}
	return controller;
}

export function unregisterOperation(operationId: string | null, controller: AbortController | null): void {
	if (!operationId) return;
	if (activeOperations.get(operationId) === controller) {
		activeOperations.delete(operationId);
	}
	if (cancelledOperations.has(operationId)) {
		const timer = setTimeout(() => cancelledOperations.delete(operationId), CANCELLED_DISCARD_SECONDS * 1000);
		timer.unref?.();
	}
}

export function cancelOperation(operationId: string): boolean {
	cancelledOperations.add(operationId);
	const controller = activeOperations.get(operationId);
	activeOperations.delete(operationId);
	if (controller) {
		controller.abort();
		return true;
	}
	// IDs that never register must expire too so the registry stays bounded.
	const timer = setTimeout(() => cancelledOperations.delete(operationId), CANCELLED_DISCARD_SECONDS * 1000);
	timer.unref?.();
	return false;
}

/** Test hook. */
export function resetOperationsForTests(): void {
	activeOperations.clear();
	cancelledOperations.clear();
}
