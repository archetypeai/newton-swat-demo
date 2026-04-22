<script>
	import { cn } from '$lib/utils.js';
	import Menubar from '$lib/components/ui/patterns/menubar/index.js';
	import Button from '$lib/components/ui/primitives/button/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import SpinnerIcon from '@lucide/svelte/icons/loader';
	import StageCard from '$lib/components/ui/custom/stage-card.svelte';
	import SuggestedActions from '$lib/components/ui/custom/suggested-actions.svelte';
	import PlaybackControls from '$lib/components/ui/custom/playback-controls.svelte';
	import PlantSchematic from '$lib/components/ui/custom/plant-schematic.svelte';
	import {
		fetchChunk,
		startSessions,
		endSessions,
		streamWindow,
		fetchSuggestions
	} from '$lib/api/swat.js';

	// Mirrors src/lib/server/newton.js STAGE_COLUMNS; kept in sync manually.
	const STAGE_COLUMNS = {
		P1: ['FIT101', 'LIT101', 'MV101', 'P101'],
		P2: ['AIT201', 'AIT202', 'AIT203', 'FIT201', 'MV201', 'P203', 'P205'],
		P3: ['DPIT301', 'FIT301', 'LIT301', 'MV301', 'MV302', 'MV303', 'MV304', 'P301', 'P302'],
		P4: ['AIT401', 'AIT402', 'FIT401', 'LIT401', 'P402', 'UV401'],
		P5: [
			'AIT501',
			'AIT502',
			'AIT503',
			'AIT504',
			'FIT501',
			'FIT502',
			'FIT503',
			'FIT504',
			'P501',
			'PIT501',
			'PIT502',
			'PIT503'
		],
		P6: ['FIT601', 'P602']
	};

	const STAGE_META = {
		P1: 'Raw water intake',
		P2: 'Chemical dosing',
		P3: 'Ultrafiltration',
		P4: 'UV dechlorination',
		P5: 'Reverse osmosis',
		P6: 'Backwash'
	};

	const STAGE_IDS = Object.keys(STAGE_COLUMNS);

	// Match server DEFAULT_CONFIG
	const WINDOW_SIZE = 30;
	const STEP_SIZE = 30;
	const CHUNK_SIZE = 10000;
	const REPLAY_SPEED = 10; // tick every 100ms, advance 1 row → 10× real time on 1Hz data
	// Jump straight into the attack period so the demo shows anomalies quickly.
	// SWaT normal days are first in the merged file (~604k rows); attacks begin after.
	const INITIAL_OFFSET = 700000;

	let rows = $state([]);
	let total = $state(0);
	let startOffset = $state(INITIAL_OFFSET);
	let loadedEnd = $state(0);
	let playheadIdx = $state(0);
	let playing = $state(false);
	let playInterval = null;
	let streamCounter = $state(0);
	let loadingChunk = $state(false);

	let sessionStatus = $state('idle'); // idle | connecting | active | error
	let setupStep = $state('');
	let sessions = $state([]);
	let sseSources = {}; // stageId → EventSource (not tracked)

	let stageStatuses = $state(Object.fromEntries(STAGE_IDS.map((s) => [s, 'idle'])));
	let stageLabels = $state(Object.fromEntries(STAGE_IDS.map((s) => [s, []])));
	// Tracks which per-stage SSE streams have delivered at least one inference result.
	// Play stays disabled until all 6 are ready, so the user can't advance the playhead
	// into a state where some stages silently produce nothing (the P4-stuck scenario).
	let stagesReady = $state(Object.fromEntries(STAGE_IDS.map((s) => [s, false])));

	let liveRow = $derived(rows[playheadIdx] ?? null);
	let sessionMap = $derived(
		Object.fromEntries(sessions.map((s) => [s.stageId, s.sessionId]))
	);
	let sessionIds = $derived(sessions.map((s) => s.sessionId));
	let readyCount = $derived(STAGE_IDS.filter((s) => stagesReady[s]).length);
	let allStagesReady = $derived(sessions.length > 0 && readyCount === STAGE_IDS.length);
	let warmingUp = $derived(sessionStatus === 'active' && !allStagesReady);

	// Gate P6 classification on activity. P6 is the backwash loop — when FIT601 ≈ 0
	// the stage is idle/standby and Newton's classification is essentially noise
	// (flat sensor values + sparse attack-class examples for P6 in the n-shot corpus).
	// Only trust the classification when the backwash is actually flowing.
	const P6_ACTIVITY_THRESHOLD = 0.01;
	let aiSuggestions = $state(null);
	let suggestionSource = $state('rules');
	let suggestionSignature = $state('');
	let suggestionDebounce = null;

	let effectiveStatuses = $derived.by(() => {
		const out = { ...stageStatuses };
		if (sessionStatus === 'active' && liveRow) {
			const flow = parseFloat(liveRow.FIT601 ?? '0');
			if (!isNaN(flow) && flow < P6_ACTIVITY_THRESHOLD) {
				out.P6 = 'standby';
			}
		}
		return out;
	});

	async function loadInitialChunk() {
		loadingChunk = true;
		try {
			const data = await fetchChunk(startOffset, CHUNK_SIZE);
			rows = data.rows;
			total = data.total;
			loadedEnd = startOffset + data.rows.length;
		} catch (err) {
			console.error('Failed to load initial chunk:', err);
		} finally {
			loadingChunk = false;
		}
	}

	async function loadNextChunk() {
		if (loadingChunk || loadedEnd >= total) return;
		loadingChunk = true;
		try {
			const data = await fetchChunk(loadedEnd, CHUNK_SIZE);
			rows = [...rows, ...data.rows];
			loadedEnd += data.rows.length;
		} catch (err) {
			console.error('Failed to load chunk:', err);
		} finally {
			loadingChunk = false;
		}
	}

	function parseSSELabel(event) {
		try {
			const parsed = JSON.parse(event.data);
			if (parsed.type === 'inference.result') {
				const raw = parsed.event_data?.response;
				if (typeof raw === 'string') return raw;
				if (Array.isArray(raw)) return raw[0];
				if (raw && typeof raw === 'object')
					return raw.class_name || raw.label || raw.prediction || null;
			}
		} catch {
			// ignore parse errors
		}
		return null;
	}

	function openStageSSE(stageId, sseUrl) {
		const proxyUrl = `/api/sse-proxy?url=${encodeURIComponent(sseUrl)}`;
		const es = new EventSource(proxyUrl);
		es.onmessage = (ev) => {
			const label = parseSSELabel(ev);
			if (!label) return;
			const upper = String(label).toUpperCase();
			stageLabels[stageId] = [...stageLabels[stageId], upper].slice(-20);
			stageStatuses[stageId] =
				upper === 'ATTACK' ? 'attack' : upper === 'NORMAL' ? 'normal' : 'pending';
			stagesReady[stageId] = true;
		};
		es.onerror = () => {
			// Keep EventSource — browser will auto-reconnect. No need to recreate here.
		};
		sseSources[stageId] = es;
	}

	async function handleStart() {
		if (sessions.length > 0) return;
		sessionStatus = 'connecting';
		setupStep = 'Starting...';
		try {
			const result = await startSessions(
				(step) => {
					setupStep = step;
				},
				{ windowSize: WINDOW_SIZE, stepSize: STEP_SIZE }
			);
			sessions = result.sessions;
			sessionStatus = 'active';
			setupStep = '';
			for (const s of result.sessions) {
				openStageSSE(s.stageId, s.sseUrl);
				stageStatuses[s.stageId] = 'pending';
			}
			preWarmSessions(2);
		} catch (err) {
			console.error('Session setup failed:', err);
			sessionStatus = 'error';
			setupStep = err.message;
		}
	}

	async function handleStop() {
		handlePause();
		for (const stageId of Object.keys(sseSources)) {
			try {
				sseSources[stageId].close();
			} catch {}
		}
		sseSources = {};
		if (sessionIds.length) {
			await endSessions(sessionIds).catch(() => {});
		}
		sessions = [];
		sessionStatus = 'idle';
		stageStatuses = Object.fromEntries(STAGE_IDS.map((s) => [s, 'idle']));
		stageLabels = Object.fromEntries(STAGE_IDS.map((s) => [s, []]));
		stagesReady = Object.fromEntries(STAGE_IDS.map((s) => [s, false]));
	}

	async function streamCurrentWindow() {
		if (!sessions.length) return;
		const windowEnd = (streamCounter + 1) * STEP_SIZE;
		const windowStart = windowEnd - WINDOW_SIZE;
		if (windowStart < 0 || windowEnd > rows.length) return;
		const windowRows = rows.slice(windowStart, windowEnd);
		try {
			await streamWindow(sessionMap, windowRows, streamCounter);
			streamCounter++;
		} catch (err) {
			console.error('Stream failed:', err);
		}
	}

	// Pre-warm Newton after sessions come up so the first classifications
	// land in the streak strip before the user even presses Play — otherwise
	// there's a ~3 s wall-time gap (at 10× replay) between Play and first result.
	async function preWarmSessions(count = 5) {
		for (let i = 0; i < count; i++) {
			await streamCurrentWindow();
		}
	}

	function handlePlay() {
		if (!rows.length) return;
		playing = true;
		playInterval = setInterval(() => {
			if (playheadIdx < rows.length - 1) {
				playheadIdx += 1;
			}

			// Pre-load next chunk when the playhead gets within 1000 rows of the end
			if (playheadIdx > rows.length - 1000 && loadedEnd < total) {
				loadNextChunk();
			}

			// Every STEP_SIZE rows, ship a window to Newton
			if (sessions.length && playheadIdx >= (streamCounter + 1) * STEP_SIZE) {
				streamCurrentWindow();
			}

			if (playheadIdx >= rows.length - 1 && loadedEnd >= total) {
				playing = false;
				clearInterval(playInterval);
			}
		}, 1000 / REPLAY_SPEED); // 100ms per tick
	}

	function handlePause() {
		playing = false;
		if (playInterval) clearInterval(playInterval);
	}

	function handleReset() {
		handlePause();
		playheadIdx = 0;
		streamCounter = 0;
		stageLabels = Object.fromEntries(STAGE_IDS.map((s) => [s, []]));
		if (sessionStatus === 'active') {
			stageStatuses = Object.fromEntries(STAGE_IDS.map((s) => [s, 'pending']));
		}
	}

	$effect(() => {
		loadInitialChunk();
	});

	// Debounced Newton-suggestion trigger: whenever the set of ATTACK stages changes,
	// wait ANOMALY_DEBOUNCE_MS for the state to settle, then ask Newton to generate
	// operator actions. Falls back to rule-based suggestions on error or empty state.
	const ANOMALY_DEBOUNCE_MS = 2000;
	let anomalySignature = $derived.by(() => {
		return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
			.filter((id) => effectiveStatuses[id] === 'attack')
			.sort()
			.join(',');
	});

	$effect(() => {
		const sig = anomalySignature;
		if (suggestionDebounce) clearTimeout(suggestionDebounce);

		if (!sig) {
			aiSuggestions = [];
			suggestionSource = 'newton';
			suggestionSignature = '';
			return;
		}

		if (sig === suggestionSignature && aiSuggestions) return;

		suggestionSource = 'loading';
		suggestionDebounce = setTimeout(async () => {
			try {
				const result = await fetchSuggestions(effectiveStatuses);
				if (result.signature !== sig) return; // state moved on while we waited
				aiSuggestions = result.suggestions ?? [];
				suggestionSource = result.source ?? 'error';
				suggestionSignature = sig;
			} catch (err) {
				console.error('Suggestions failed:', err);
				aiSuggestions = null; // fall through to rule-based in the component
				suggestionSource = 'error';
			}
		}, ANOMALY_DEBOUNCE_MS);
	});
</script>

<svelte:head><title>Newton · SWaT</title></svelte:head>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
>
	Skip to content
</a>

{#snippet partnerSnippet()}
	<span class="text-muted-foreground font-mono text-sm tracking-wider uppercase">
		SWaT · 6-stage water treatment
	</span>
{/snippet}

<div
	class="bg-background text-foreground grid h-screen grid-rows-[auto_auto_auto_1fr] overflow-hidden"
>
	<Menubar partnerLogo={partnerSnippet}>
		{#if sessionStatus === 'active' && warmingUp}
			<Badge variant="outline" class="text-atai-warning font-mono">
				<SpinnerIcon class="size-3 animate-spin" aria-hidden="true" />
				Warming up · {readyCount}/{STAGE_IDS.length} stages ready
			</Badge>
			<Button variant="outline" size="sm" onclick={handleStop}>Stop</Button>
		{:else if sessionStatus === 'active'}
			<Badge variant="outline" class="text-atai-good font-mono">Newton · 6 sessions ready</Badge>
			<Button variant="outline" size="sm" onclick={handleStop}>Stop</Button>
		{:else if sessionStatus === 'connecting'}
			<Button variant="default" size="sm" disabled>
				<SpinnerIcon class="size-3.5 animate-spin" aria-hidden="true" />
				{setupStep || 'Connecting...'}
			</Button>
		{:else}
			<Button variant="default" size="sm" onclick={handleStart} disabled={!rows.length}>
				Start analysis
			</Button>
		{/if}
	</Menubar>

	<div class="border-border flex items-center gap-4 border-b px-4 py-2">
		<PlaybackControls
			{playing}
			current={startOffset + playheadIdx}
			{total}
			speed={REPLAY_SPEED}
			disabled={!rows.length || warmingUp}
			onplay={handlePlay}
			onpause={handlePause}
			onreset={handleReset}
		/>
	</div>

	<main id="main-content" class="grid grid-cols-[3fr_1fr] gap-4 overflow-hidden p-4">
		<h1 class="sr-only">SWaT per-stage anomaly dashboard</h1>

		<div class="flex min-h-0 flex-col gap-3 overflow-hidden">
			<section aria-label="Plant process flow" class="shrink-0">
				<PlantSchematic stageStatuses={effectiveStatuses} class="max-h-44" />
			</section>

			<section
				class="grid min-h-0 flex-1 grid-cols-6 gap-3 overflow-hidden"
				aria-label="Process stages"
			>
				{#each STAGE_IDS as stageId}
					<StageCard
						{stageId}
						stageName={STAGE_META[stageId]}
						columns={STAGE_COLUMNS[stageId]}
						{liveRow}
						status={effectiveStatuses[stageId]}
						recentLabels={stageLabels[stageId]}
						class="min-h-0 overflow-hidden"
					/>
				{/each}
			</section>
		</div>

		<section class="min-h-0 overflow-hidden" aria-label="Suggested actions">
			<SuggestedActions
				stageStatuses={effectiveStatuses}
				stageNames={STAGE_META}
				{aiSuggestions}
				source={suggestionSource}
			/>
		</section>
	</main>

	{#if sessionStatus === 'error'}
		<div
			class="bg-destructive text-destructive-foreground fixed right-4 bottom-4 max-w-md rounded-md px-4 py-3 font-mono text-xs"
			role="alert"
		>
			Session setup error: {setupStep}
		</div>
	{/if}
</div>
