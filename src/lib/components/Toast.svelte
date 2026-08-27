<script lang="ts">
	import { toastState } from '$lib/frontend/toast.svelte';
</script>

<div id="toast" class="toast {toastState.kind}" class:hidden={!toastState.visible}>
	{toastState.message}
</div>

