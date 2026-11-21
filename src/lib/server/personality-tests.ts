/**
 * The catalog behind /personality: links to free online personality tests, grouped by kind.
 *
 * SpaceBot only links. It does not run the tests, see anyone's answers or vouch for what a test
 * claims. Every URL here was opened and its page title checked on 2026-11-19. Add one only after
 * doing the same, and say if it is adult. Paid tests are not listed. Quizzes are for curiosity: the neurodiversity
 * ones are screening aids, not a diagnosis, and the replies say so.
 *
 * Pure: no database, no Discord. The command and the dashboard both build on this.
 */

export interface PersonalityCategory {
	id: string;
	label: string;
	emoji: string;
}

export interface PersonalityTest {
	id: string;
	name: string;
	category: string;
	url: string;
	blurb: string;
	/** Adult content (18+). */
	adult?: boolean;
	keywords: string[];
}

export const CATEGORIES: PersonalityCategory[] = [
	{ id: 'type', label: 'Type & temperament', emoji: '🧩' },
	{ id: 'traits', label: 'Big Five & traits', emoji: '📊' },
	{ id: 'neuro', label: 'Autism & neurodiversity', emoji: '🧠' },
	{ id: 'relationships', label: 'Relationships & intimacy', emoji: '💞' },
	{ id: 'dark', label: 'Dark traits', emoji: '🌑' },
	{ id: 'career', label: 'Career & strengths', emoji: '💼' },
	{ id: 'values', label: 'Values & politics', emoji: '🧭' },
	{ id: 'fun', label: 'Just for fun', emoji: '🎩' },
	{ id: 'hubs', label: 'More tests', emoji: '🔎' },
];

/** The id a server's own links are filed under in replies. */
export const SERVER_CATEGORY = 'server';

export const TESTS: PersonalityTest[] = [
	// Type & temperament
	{
		id: '16personalities',
		name: '16Personalities',
		category: 'type',
		url: 'https://www.16personalities.com/free-personality-test',
		blurb: 'A free Myers-Briggs-style quiz that gives one of 16 types.',
		keywords: ['mbti', 'myers briggs', '16 types', 'intj', 'infp', 'enfp', 'introvert'],
	},
	{
		id: 'truity-typefinder',
		name: 'TypeFinder (Truity)',
		category: 'type',
		url: 'https://www.truity.com/test/type-finder-personality-test-new',
		blurb: 'A 16-type test based on Myers and Briggs’ types.',
		keywords: ['mbti', 'myers briggs', '16 types', 'truity'],
	},
	{
		id: 'oejts',
		name: 'Open Extended Jungian Type Scales',
		category: 'type',
		url: 'https://openpsychometrics.org/tests/OEJTS/',
		blurb: 'An open, free Jung and Myers-Briggs style type test.',
		keywords: ['mbti', 'myers briggs', 'jung', 'open psychometrics'],
	},
	{
		id: 'humanmetrics',
		name: 'Humanmetrics Jung Typology',
		category: 'type',
		url: 'https://www.humanmetrics.com/personality',
		blurb: 'A Jung and Myers-Briggs style typology test.',
		keywords: ['mbti', 'myers briggs', 'jung', 'typology'],
	},
	{
		id: 'truity-temperament',
		name: 'TypeFinder Temperament Test',
		category: 'type',
		url: 'https://www.truity.com/test/temperament-test',
		blurb: 'Which of the four temperaments fits you.',
		keywords: ['temperament', 'keirsey', 'truity'],
	},
	{
		id: 'truity-enneagram',
		name: 'Enneagram Test (Truity)',
		category: 'type',
		url: 'https://www.truity.com/test/enneagram-personality-test',
		blurb: 'A free Enneagram test for your type of nine.',
		keywords: ['enneagram', 'nine types', 'truity'],
	},
	{
		id: 'sociotype',
		name: 'Sociotype',
		category: 'type',
		url: 'https://sociotype.com/',
		blurb: 'Socionics tests and reference.',
		keywords: ['socionics', 'sociotype', 'jung', 'type'],
	},
	{
		id: 'disc-truity',
		name: 'DISC Assessment (Truity)',
		category: 'type',
		url: 'https://www.truity.com/test/disc-personality-test',
		blurb: 'A DISC style test for how you work with others.',
		keywords: ['disc', 'work style', 'truity'],
	},

	// Big Five & traits
	{
		id: 'ipip-bffm',
		name: 'Big Five (Open Psychometrics)',
		category: 'traits',
		url: 'https://openpsychometrics.org/tests/IPIP-BFFM/',
		blurb: 'A free Big Five test using the open IPIP items.',
		keywords: ['big five', 'big 5', 'ocean', 'openness', 'extraversion', 'ipip'],
	},
	{
		id: 'truity-big5',
		name: 'Big Five (Truity)',
		category: 'traits',
		url: 'https://www.truity.com/test/big-five-personality-test',
		blurb: 'A free Big Five test with scores for each trait.',
		keywords: ['big five', 'big 5', 'ocean', 'truity'],
	},
	{
		id: '123test-big5',
		name: 'Big Five (123test)',
		category: 'traits',
		url: 'https://www.123test.com/personality-test/',
		blurb: 'A free Big Five personality test.',
		keywords: ['big five', 'big 5', 'ocean', '123test'],
	},
	{
		id: 'hexaco',
		name: 'HEXACO',
		category: 'traits',
		url: 'https://hexaco.org/hexaco-online',
		blurb: 'Six traits, adding Honesty-Humility to the Big Five.',
		keywords: ['hexaco', 'honesty humility', 'six factor'],
	},

	// Autism & neurodiversity
	{
		id: 'aq',
		name: 'Autism Spectrum Quotient (AQ)',
		category: 'neuro',
		url: 'https://embrace-autism.com/autism-spectrum-quotient/',
		blurb: 'A short autistic-traits questionnaire. A screening aid, not a diagnosis.',
		keywords: ['autism', 'autistic', 'aq', 'asd', 'neurodivergent', 'spectrum'],
	},
	{
		id: 'raads-r',
		name: 'RAADS-R',
		category: 'neuro',
		url: 'https://embrace-autism.com/raads-r/',
		blurb: 'A longer autism questionnaire for adults. A screening aid, not a diagnosis.',
		keywords: ['autism', 'autistic', 'raads', 'adult', 'asd', 'neurodivergent'],
	},
	{
		id: 'cat-q',
		name: 'CAT-Q (camouflaging)',
		category: 'neuro',
		url: 'https://embrace-autism.com/cat-q/',
		blurb: 'How much you hide autistic traits (masking).',
		keywords: ['autism', 'masking', 'camouflaging', 'cat-q', 'neurodivergent'],
	},
	{
		id: 'aspie-tests',
		name: 'Aspie Tests',
		category: 'neuro',
		url: 'https://aspietests.org/',
		blurb: 'Autism-related quizzes in one place. Screening aids, not a diagnosis.',
		keywords: ['autism', 'aspergers', 'aspie', 'neurodivergent'],
	},

	// Relationships & intimacy
	{
		id: 'bdsm-test',
		name: 'BDSM Test',
		category: 'relationships',
		url: 'https://bdsmtest.org/',
		blurb: 'A free test of BDSM and kink preferences.',
		adult: true,
		keywords: ['bdsm', 'kink', 'dom', 'sub', 'switch', 'fetish', 'adult', 'nsfw'],
	},
	{
		id: 'attachment-style',
		name: 'Attachment Style Quiz',
		category: 'relationships',
		url: 'https://www.attachmentproject.com/attachment-style-quiz/',
		blurb: 'Secure, anxious, avoidant or fearful-avoidant.',
		keywords: ['attachment', 'anxious', 'avoidant', 'secure', 'relationships', 'dating'],
	},
	{
		id: 'love-languages',
		name: 'Love Language Quiz',
		category: 'relationships',
		url: 'https://5lovelanguages.com/quizzes/love-language',
		blurb: 'The official quiz from the Five Love Languages.',
		keywords: ['love languages', 'love language', 'relationships', 'dating', 'gary chapman'],
	},

	// Dark traits
	{
		id: 'sd3',
		name: 'Dark Triad (SD3)',
		category: 'dark',
		url: 'https://openpsychometrics.org/tests/SD3/',
		blurb: 'Machiavellianism, narcissism and psychopathy traits.',
		keywords: ['dark triad', 'narcissism', 'machiavellian', 'psychopathy', 'sd3'],
	},
	{
		id: 'npi',
		name: 'Narcissistic Personality Inventory',
		category: 'dark',
		url: 'https://openpsychometrics.org/tests/NPI/',
		blurb: 'A research questionnaire on narcissistic traits.',
		keywords: ['narcissism', 'narcissist', 'npi', 'dark'],
	},

	// Career & strengths
	{
		id: 'onet-interest',
		name: 'O*NET Interest Profiler',
		category: 'career',
		url: 'https://onetinterestprofiler.org/',
		blurb: 'Matches your interests to careers.',
		keywords: ['career', 'holland', 'riasec', 'jobs', 'interests', 'onet'],
	},
	{
		id: 'riasec',
		name: 'Holland Code / RIASEC (Open Psychometrics)',
		category: 'career',
		url: 'https://openpsychometrics.org/tests/RIASEC/',
		blurb: 'A free Holland Code career interest test.',
		keywords: ['career', 'holland', 'riasec', 'jobs', 'interests'],
	},
	{
		id: 'holland-truity',
		name: 'Holland Code Career Test (Truity)',
		category: 'career',
		url: 'https://www.truity.com/test/holland-code-career-test',
		blurb: 'Find your Holland Code and matching jobs.',
		keywords: ['career', 'holland', 'riasec', 'jobs', 'truity'],
	},
	{
		id: 'via-strengths',
		name: 'VIA Character Strengths',
		category: 'career',
		url: 'https://www.viacharacter.org/',
		blurb: 'Your top character strengths, free.',
		keywords: ['strengths', 'character', 'via', 'positive psychology'],
	},
	{
		id: 'truity-eq',
		name: 'Emotional Intelligence Test (Truity)',
		category: 'career',
		url: 'https://www.truity.com/test/emotional-intelligence-test',
		blurb: 'How well you read and manage emotions.',
		keywords: ['eq', 'emotional intelligence', 'emotions', 'truity'],
	},

	// Values & politics
	{
		id: 'political-compass',
		name: 'The Political Compass',
		category: 'values',
		url: 'https://www.politicalcompass.org/test',
		blurb: 'Where you sit on economic and social axes.',
		keywords: [
			'politics',
			'political',
			'compass',
			'left',
			'right',
			'libertarian',
			'authoritarian',
		],
	},
	{
		id: '8values',
		name: '8values',
		category: 'values',
		url: 'https://8values.github.io/',
		blurb: 'Political values on four axes.',
		keywords: ['politics', 'political', 'values', '8values', 'ideology'],
	},
	{
		id: 'pew-typology',
		name: 'Pew Political Typology Quiz',
		category: 'values',
		url: 'https://www.pewresearch.org/politics/quiz/political-typology/',
		blurb: 'Which of nine US political groups you are closest to.',
		keywords: ['politics', 'political', 'pew', 'typology', 'us', 'america'],
	},

	// Just for fun
	{
		id: 'sorting-hat',
		name: 'Wizarding World Sorting Hat',
		category: 'fun',
		url: 'https://www.harrypotter.com/sorting-hat',
		blurb: 'Which Hogwarts house you belong in.',
		keywords: ['harry potter', 'hogwarts', 'sorting hat', 'gryffindor', 'slytherin', 'house'],
	},

	// More tests
	{
		id: 'open-psychometrics',
		name: 'Open Psychometrics',
		category: 'hubs',
		url: 'https://openpsychometrics.org/tests/',
		blurb: 'Many free research-style tests in one place.',
		keywords: ['open psychometrics', 'many', 'all', 'research'],
	},
	{
		id: 'idrlabs',
		name: 'IDRlabs',
		category: 'hubs',
		url: 'https://www.idrlabs.com/',
		blurb: 'A large collection of quizzes, serious and silly.',
		keywords: ['idrlabs', 'many', 'all', 'quizzes'],
	},
	{
		id: 'psychology-today',
		name: 'Psychology Today Tests',
		category: 'hubs',
		url: 'https://www.psychologytoday.com/us/tests/personality',
		blurb: 'Personality tests from Psychology Today.',
		keywords: ['psychology today', 'many', 'all'],
	},
	{
		id: 'ipip',
		name: 'International Personality Item Pool',
		category: 'hubs',
		url: 'https://ipip.ori.org/',
		blurb: 'The free question bank behind many Big Five tests.',
		keywords: ['ipip', 'item pool', 'big five', 'research'],
	},
];

const BY_ID = new Map(TESTS.map((t) => [t.id, t]));
export const TEST_IDS = new Set(TESTS.map((t) => t.id));
const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const categoryLabel = (id: string) => CATEGORY_BY_ID.get(id)?.label ?? 'Your server’s picks';
export const categoryEmoji = (id: string) => CATEGORY_BY_ID.get(id)?.emoji ?? '⭐';
export const getTest = (id: string) => BY_ID.get(id);

/** A test a server added itself. */
export interface CustomTest {
	id: number;
	name: string;
	url: string;
	category: string;
	note: string | null;
}

/** Anything the replies can show: a built-in test or a server's own link. */
export interface Listed {
	key: string;
	name: string;
	url: string;
	category: string;
	blurb: string;
	adult?: boolean;
	keywords: string[];
	own?: boolean;
}

export function listed(hidden: ReadonlySet<string>, custom: readonly CustomTest[]): Listed[] {
	const built = TESTS.filter((t) => !hidden.has(t.id)).map((t) => ({
		key: t.id,
		name: t.name,
		url: t.url,
		category: t.category,
		blurb: t.blurb,
		adult: t.adult,
		keywords: t.keywords,
	}));
	const own = custom.map((c) => ({
		key: `own-${c.id}`,
		name: c.name,
		url: c.url,
		category: c.category,
		blurb: c.note ?? '',
		keywords: [] as string[],
		own: true,
	}));
	return [...built, ...own];
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * Rank entries against a search. The exact name wins, then names that start or contain it, then
 * keywords, then the category label and blurb. Every word of the query must match somewhere.
 */
export function search(items: readonly Listed[], query: string): Listed[] {
	const q = norm(query);
	if (!q) return [];
	const words = q.split(' ');
	const scored: { item: Listed; score: number }[] = [];
	for (const item of items) {
		const name = norm(item.name);
		const kw = item.keywords.map(norm);
		const rest = norm(`${categoryLabel(item.category)} ${item.blurb}`);
		const hay = `${name} ${kw.join(' ')} ${rest}`;
		if (!words.every((w) => hay.includes(w))) continue;
		let score = 1;
		if (name === q) score = 100;
		else if (name.startsWith(q)) score = 60;
		else if (name.includes(q)) score = 40;
		else if (kw.some((k) => k === q)) score = 30;
		else if (kw.some((k) => k.includes(q))) score = 20;
		scored.push({ item, score });
	}
	return scored
		.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
		.map((s) => s.item);
}

/** Built-in tests (hidden or not) matching a name, for hide and show. Exact name or id first. */
export function matchBuiltIn(query: string): PersonalityTest[] {
	const q = norm(query);
	if (!q) return [];
	const exact = TESTS.filter((t) => norm(t.name) === q || t.id === q.replace(/ /g, '-'));
	if (exact.length) return exact;
	return search(
		TESTS.map((t) => ({ ...t, key: t.id })),
		query
	).map((l) => BY_ID.get(l.key)!);
}

// ---- A server's own links ---------------------------------------------------------------------

export const MAX_CUSTOM_TESTS = 50;
export const MAX_NAME_LENGTH = 60;
export const MAX_NOTE_LENGTH = 120;
export const MAX_URL_LENGTH = 300;

const oneLine = (raw: unknown, max: number) =>
	String(raw ?? '')
		.replace(/\s+/g, ' ')
		.replace(/[*_~`|<>[\]()]/g, '')
		.trim()
		.slice(0, max);

export const cleanName = (raw: unknown) => oneLine(raw, MAX_NAME_LENGTH);
export const cleanNote = (raw: unknown) => oneLine(raw, MAX_NOTE_LENGTH);

/**
 * A link a server may add: https only, a real host, no login in the address, no private or local
 * hosts. Returns the cleaned URL, or null.
 */
export function cleanUrl(raw: unknown): string | null {
	const text = String(raw ?? '').trim();
	if (!text || text.length > MAX_URL_LENGTH || /\s/.test(text)) return null;
	let u: URL;
	try {
		u = new URL(text);
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' || u.username || u.password) return null;
	const host = u.hostname.toLowerCase();
	if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) return null;
	if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null;
	if (host === 'localhost' || host.endsWith('.localhost')) return null;
	return u.toString();
}

// ---- Replies ------------------------------------------------------------------------------------

const COLOR = 0x9b59b6;
export const DISCLAIMER =
	'Free online quizzes for curiosity, not a diagnosis. SpaceBot only links; it never sees your answers.';
const FIELD_MAX = 1000;
const EMBED_BUDGET = 5200;

const tags = (i: Listed) => `${i.adult ? ' 🔞' : ''}`;

/** One line with the blurb: used when a single category or a few results are shown. */
export function detailedLine(i: Listed): string {
	return `**[${i.name}](${i.url})**${tags(i)}${i.blurb ? ` — ${i.blurb}` : ''}`;
}

/** Name and link only: used for the whole list. */
export function compactLine(i: Listed): string {
	return `[${i.name}](${i.url})${tags(i)}`;
}

function clip(lines: string[], sep: string, max: number): string {
	let out = '';
	for (let n = 0; n < lines.length; n++) {
		const next = out ? out + sep + lines[n] : lines[n];
		if (next.length > max)
			return `${out}${sep}…and ${lines.length - n} more`.slice(0, max + 40);
		out = next;
	}
	return out;
}

function groups(items: readonly Listed[]) {
	const ids = [...CATEGORIES.map((c) => c.id), SERVER_CATEGORY];
	const known = new Set(ids);
	return ids
		.map((id) => ({
			id,
			items: items.filter(
				(i) => (known.has(i.category) ? i.category : SERVER_CATEGORY) === id
			),
		}))
		.filter((g) => g.items.length > 0);
}

/** The whole list: one field per category, names and links only. */
export function listEmbed(items: readonly Listed[]) {
	if (items.length === 0) return emptyEmbed();
	let used = 0;
	const fields = [];
	for (const g of groups(items)) {
		const name = `${categoryEmoji(g.id)} ${categoryLabel(g.id)}`;
		const value = clip(g.items.map(compactLine), ' · ', FIELD_MAX);
		if (used + name.length + value.length > EMBED_BUDGET) break;
		used += name.length + value.length;
		fields.push({ name, value, inline: false });
	}
	return {
		title: 'Personality tests',
		description:
			'Pick one, or use `/personality find` to search, or `/personality list category:` for notes on each.',
		color: COLOR,
		fields,
		footer: { text: DISCLAIMER },
	};
}

/** One category, with a note on each test. */
export function categoryEmbed(category: string, items: readonly Listed[]) {
	const here = items.filter((i) => i.category === category);
	return {
		title: `${categoryEmoji(category)} ${categoryLabel(category)}`,
		description: here.length
			? clip(here.map(detailedLine), '\n', 3800)
			: 'This server is not showing any tests in this category.',
		color: COLOR,
		footer: { text: DISCLAIMER },
	};
}

/** Search results, with notes. */
export function findEmbed(query: string, results: readonly Listed[]) {
	const shown = results.slice(0, 6);
	return {
		title: `Personality tests: ${oneLine(query, 60)}`,
		description:
			clip(shown.map(detailedLine), '\n', 3800) +
			(results.length > shown.length
				? `\n-# ${results.length - shown.length} more match. Try a longer search.`
				: ''),
		color: COLOR,
		footer: { text: DISCLAIMER },
	};
}

export function emptyEmbed() {
	return {
		title: 'Personality tests',
		description: 'This server is not showing any tests right now.',
		color: COLOR,
		footer: { text: DISCLAIMER },
	};
}
