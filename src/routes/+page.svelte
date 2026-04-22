<script>
	import Menubar from '$lib/components/ui/patterns/menubar/index.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import { Badge } from '$lib/components/ui/primitives/badge/index.js';

	const STAGES = [
		{ id: 'P1', name: 'Raw water intake' },
		{ id: 'P2', name: 'Chemical dosing' },
		{ id: 'P3', name: 'Ultrafiltration' },
		{ id: 'P4', name: 'UV dechlorination' },
		{ id: 'P5', name: 'Reverse osmosis' },
		{ id: 'P6', name: 'Backwash' }
	];
</script>

<svelte:head><title>Newton · SWaT</title></svelte:head>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
>
	Skip to content
</a>

<div class="flex h-screen flex-col">
	<Menubar>
		<Badge variant="outline" class="font-mono">SWaT · 6-stage water treatment</Badge>
	</Menubar>

	<main id="main-content" class="flex-1 overflow-hidden p-6">
		<h1 class="sr-only">SWaT per-stage anomaly dashboard</h1>

		<div class="grid h-full grid-cols-6 gap-4">
			{#each STAGES as stage}
				<BackgroundCard class="flex flex-col justify-between p-4">
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground font-mono text-sm">{stage.id}</span>
						<span class="bg-atai-neutral size-2 rounded-full" aria-hidden="true"></span>
					</div>
					<div>
						<p class="font-mono text-lg">{stage.name}</p>
						<p class="text-muted-foreground mt-2 text-xs">Awaiting stream</p>
					</div>
				</BackgroundCard>
			{/each}
		</div>
	</main>
</div>
