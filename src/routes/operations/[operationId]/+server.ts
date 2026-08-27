import { json } from '@sveltejs/kit';
import { cancelOperation } from '$lib/server/operations';

export async function DELETE({ params }) {
	const operationId = params.operationId ?? '';
	cancelOperation(operationId);
	return json({ cancelled: true });
}
