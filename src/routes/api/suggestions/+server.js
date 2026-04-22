import { json } from '@sveltejs/kit';
import { queryNewton } from '$lib/server/newton.js';

const SYSTEM_PROMPT = `You are an operator assistant for the SWaT six-stage water treatment plant. Flow: P1 raw intake → P2 chemical dosing → P3 ultrafiltration → P4 UV dechlorination → P5 reverse osmosis → treated water. P6 backwash recycles P5 reject to clean P3 UF membranes.

For each stage marked ATTACK, suggest specific operator actions: upstream (reduce/hold feed from the previous stage), local (check equipment on that stage), and downstream (alert/protect the next stage from cascading effects).

Return ONLY a JSON array. No prose, no markdown code fences, no explanation — just the JSON. Shape:
[{"origin":"Pn","target":"Pm","direction":"upstream|local|downstream","text":"..."}]

Rules:
- Only generate suggestions for stages marked ATTACK. Skip NORMAL, STANDBY, CLASSIFYING.
- For each ATTACK stage emit 1-3 suggestions (local is required; upstream and downstream if they exist).
- P1 has no upstream (first stage). P6 has no downstream (backwash is terminal).
- Keep each "text" field under 120 characters, imperative voice, concrete ("reduce", "check", "isolate").`;

// In-memory cache keyed by anomaly signature (e.g. "P1,P4"). Cleared on server restart.
const cache = new Map();

function buildQuery(stageStatuses) {
	const names = {
		P1: 'raw intake',
		P2: 'chemical dosing',
		P3: 'ultrafiltration',
		P4: 'UV dechlorination',
		P5: 'reverse osmosis',
		P6: 'backwash'
	};
	const lines = Object.entries(names).map(
		([id, name]) => `- ${id} ${name}: ${(stageStatuses[id] ?? 'idle').toUpperCase()}`
	);
	return `Current plant state:\n${lines.join('\n')}\n\nGenerate suggestions for ATTACK stages only.`;
}

function parseSuggestions(text) {
	if (!text) return null;
	// Strip markdown code fences if Newton wraps the JSON anyway
	const cleaned = text
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/i, '')
		.trim();
	const start = cleaned.indexOf('[');
	const end = cleaned.lastIndexOf(']');
	if (start === -1 || end === -1 || end <= start) return null;
	try {
		const parsed = JSON.parse(cleaned.slice(start, end + 1));
		if (!Array.isArray(parsed)) return null;
		// Shape-check each suggestion; drop anything malformed
		return parsed
			.filter(
				(s) =>
					s &&
					typeof s.origin === 'string' &&
					typeof s.target === 'string' &&
					typeof s.direction === 'string' &&
					typeof s.text === 'string' &&
					['upstream', 'local', 'downstream'].includes(s.direction)
			)
			.map((s) => ({
				origin: s.origin,
				target: s.target,
				direction: s.direction,
				text: s.text
			}));
	} catch {
		return null;
	}
}

export async function POST({ request }) {
	try {
		const { stageStatuses } = await request.json();
		if (!stageStatuses) return json({ error: 'Missing stageStatuses' }, { status: 400 });

		const anomalous = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
			.filter((id) => stageStatuses[id] === 'attack')
			.sort();
		const signature = anomalous.join(',') || 'none';

		if (anomalous.length === 0) {
			return json({ suggestions: [], source: 'newton', signature });
		}

		if (cache.has(signature)) {
			return json({ suggestions: cache.get(signature), source: 'newton-cached', signature });
		}

		const raw = await queryNewton({
			query: buildQuery(stageStatuses),
			systemPrompt: SYSTEM_PROMPT,
			maxNewTokens: 768
		});
		const parsed = parseSuggestions(raw);

		if (!parsed || parsed.length === 0) {
			return json({
				suggestions: [],
				source: 'error',
				signature,
				error: 'Newton response did not parse',
				raw
			});
		}

		cache.set(signature, parsed);
		return json({ suggestions: parsed, source: 'newton', signature });
	} catch (err) {
		return json({ error: err.message, source: 'error' }, { status: 500 });
	}
}
