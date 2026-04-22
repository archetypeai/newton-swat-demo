<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';

	/**
	 * @typedef {Object} Suggestion
	 * @property {string} origin
	 * @property {string} target
	 * @property {'upstream'|'local'|'downstream'} direction
	 * @property {string} text
	 */

	/**
	 * @typedef {Object} Props
	 * @property {Record<string,'normal'|'attack'|'pending'|'idle'|'standby'>} stageStatuses
	 * @property {Record<string,string>} [stageNames]
	 * @property {Suggestion[]|null} [aiSuggestions] - AI-generated; falls back to hardcoded rules when null
	 * @property {'newton'|'newton-cached'|'rules'|'loading'|'error'} [source]
	 * @property {string} [class]
	 */

	/** @type {Props} */
	let {
		stageStatuses,
		stageNames = {},
		aiSuggestions = null,
		source = 'rules',
		class: className,
		...restProps
	} = $props();

	// Suggestions are framed as recommendations for a human operator.
	// Not autonomous actions — the design principles rule distinguishes Measure/Reason ("system shows/suggests")
	// from Operate ("system acts"). This panel is strictly Reason layer.
	const RULES = {
		P1: {
			upstream: null,
			local: 'Check raw water intake — flow, tank level, and intake pump state.',
			downstream: 'Reduce draw to P2; buffer raw water if available.'
		},
		P2: {
			upstream: 'Reduce raw water feed from P1; hold incoming flow.',
			local: 'Verify chemical dosing pumps and analyzer calibration.',
			downstream: 'Notify P3 — chemistry may be out of spec entering UF.'
		},
		P3: {
			upstream: 'Stop feed from P2; isolate UF intake.',
			local: 'Inspect UF membrane integrity and backwash cycle state.',
			downstream: 'Hold P4 and enable bypass tank.'
		},
		P4: {
			upstream: 'Reduce feed from P3; divert to buffer tank.',
			local: 'Check UV lamp health and dechlorination analyzer readings.',
			downstream: 'Alert P5 — chlorine breakthrough risk for RO membranes.'
		},
		P5: {
			upstream: 'Reduce feed from P4 immediately.',
			local: 'Check RO pressure, conductivity, and high-pressure pump.',
			downstream: 'Pause P6 backwash cycle until RO stabilises.'
		},
		P6: {
			upstream: 'Halt backwash draw from P5.',
			local: 'Check backwash pump and outflow meter.',
			downstream: null
		}
	};

	const STAGE_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

	let anomalous = $derived(STAGE_ORDER.filter((s) => stageStatuses[s] === 'attack'));

	let ruleSuggestions = $derived.by(() => {
		const out = [];
		for (const stageId of anomalous) {
			const rule = RULES[stageId];
			if (!rule) continue;
			const idx = STAGE_ORDER.indexOf(stageId);
			const upstreamId = idx > 0 ? STAGE_ORDER[idx - 1] : null;
			const downstreamId = idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
			if (rule.upstream && upstreamId) {
				out.push({
					origin: stageId,
					target: upstreamId,
					direction: 'upstream',
					text: rule.upstream
				});
			}
			out.push({ origin: stageId, target: stageId, direction: 'local', text: rule.local });
			if (rule.downstream && downstreamId) {
				out.push({
					origin: stageId,
					target: downstreamId,
					direction: 'downstream',
					text: rule.downstream
				});
			}
		}
		return out;
	});

	// Prefer AI suggestions when available; fall back to rules while loading or on error
	let suggestions = $derived(aiSuggestions ?? ruleSuggestions);

	const SOURCE_LABEL = {
		newton: 'Newton reasoning',
		'newton-cached': 'Newton reasoning (cached)',
		loading: 'Newton analysing…',
		rules: 'Rule-based',
		error: 'Rule-based (fallback)'
	};
	const SOURCE_TONE = {
		newton: 'text-atai-good',
		'newton-cached': 'text-atai-good',
		loading: 'text-atai-warning',
		rules: 'text-muted-foreground',
		error: 'text-muted-foreground'
	};

	const ICON_BY_DIR = {
		upstream: ArrowUpIcon,
		downstream: ArrowDownIcon,
		local: CircleDotIcon
	};
</script>

<BackgroundCard class={cn('flex h-full flex-col gap-3 p-4', className)} {...restProps}>
	<header class="flex flex-col gap-1">
		<div class="flex items-baseline justify-between">
			<h2 class="font-mono text-sm">Suggested actions</h2>
			<span class="text-muted-foreground font-mono text-xs">
				{suggestions.length} active · {anomalous.length} stage{anomalous.length === 1 ? '' : 's'}
			</span>
		</div>
		<span class={cn('font-mono text-[10px] uppercase tracking-wider', SOURCE_TONE[source])}>
			{SOURCE_LABEL[source]}
		</span>
	</header>

	{#if suggestions.length === 0}
		<p class="text-muted-foreground flex-1 text-xs">
			No anomalies detected. Operator guidance will appear here when a stage flags attack-class.
		</p>
	{:else}
		<ul role="list" class="flex flex-col gap-2 overflow-y-auto">
			{#each suggestions as s}
				{@const Icon = ICON_BY_DIR[s.direction]}
				<li
					role="listitem"
					class="border-border flex items-start gap-3 rounded-md border p-3"
				>
					<Icon
						class={cn(
							'mt-0.5 size-4 shrink-0',
							s.direction === 'local' ? 'text-atai-warning' : 'text-muted-foreground'
						)}
						aria-hidden="true"
					/>
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<div class="flex items-center gap-2">
							<Badge variant="outline" class="text-atai-critical font-mono text-[10px]">
								{s.origin} anomaly
							</Badge>
							<span class="text-muted-foreground font-mono text-[10px] uppercase">
								{s.direction}
							</span>
							{#if s.direction !== 'local'}
								<Badge variant="outline" class="font-mono text-[10px]">
									→ {s.target}
								</Badge>
							{/if}
						</div>
						<p class="text-sm">{s.text}</p>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</BackgroundCard>
