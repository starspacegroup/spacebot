/**
 * What a link to a SpaceBot page looks like when it is shared (Discord, X, Slack, iMessage).
 *
 * One table maps each route to a share card (the 1200×630 image drawn by `/api/og`) and to the
 * title and description in the preview. The root layout turns the match into tags, so a new
 * public page needs one line here and nothing else.
 *
 * The card list is fixed on purpose: `/api/og` draws only these cards, never text taken from the
 * request, so nobody can make our domain print a message of their choosing.
 */

export const SITE_URL = 'https://spacebot.starspace.group';
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgCard {
	title: string;
	subtitle: string;
	/** One line. The card is 1200 px wide, so keep it short (the tests cap it). */
	description: string;
}

export const OG_CARDS = {
	home: {
		title: 'SpaceBot',
		subtitle: 'The powerful Discord bot platform you control',
		description: 'Custom commands · Automations · AI Assistant · Analytics · Integrations',
	},
	docs: {
		title: 'Documentation',
		subtitle: 'SpaceBot',
		description:
			'Set up and use custom commands, automations, integrations, the REST API and more.',
	},
	devdocs: {
		title: 'Developer Docs',
		subtitle: 'SpaceBot',
		description: 'The REST API and integrations, for people building on SpaceBot.',
	},
	status: {
		title: 'Service Status',
		subtitle: 'SpaceBot',
		description: 'Live checks of the website, database and bot, with incident history.',
	},
	servers: {
		title: 'Server Browser',
		subtitle: 'SpaceBot',
		description: 'Discord communities that run SpaceBot and chose to be listed.',
	},
	leaderboards: {
		title: 'Leaderboards',
		subtitle: 'SpaceBot',
		description: 'Server leaderboards from the communities that run SpaceBot.',
	},
	ideas: {
		title: 'Send an Idea',
		subtitle: 'SpaceBot',
		description: 'Tell us what SpaceBot should do next. We read every one.',
	},
	vote: {
		title: 'Vote for SpaceBot',
		subtitle: 'SpaceBot',
		description: 'Help more servers find SpaceBot with a vote or a review.',
	},
	support: {
		title: 'Support',
		subtitle: 'SpaceBot',
		description: 'Join the support server for setup help and release updates.',
	},
	invite: {
		title: 'Add SpaceBot',
		subtitle: 'Install it on your Discord server',
		description: 'Slash commands, context menus, automations and analytics.',
	},
	login: {
		title: 'Sign in',
		subtitle: 'SpaceBot',
		description: 'Sign in with Discord to open your dashboard.',
	},
	dashboard: {
		title: 'Dashboard',
		subtitle: 'SpaceBot',
		description: 'Manage commands, automations and settings for your server.',
	},
	profile: {
		title: 'Member Profile',
		subtitle: 'SpaceBot',
		description: 'A member profile on a server that runs SpaceBot.',
	},
	privacy: {
		title: 'Privacy Policy',
		subtitle: 'SpaceBot',
		description: 'How we collect, use, and protect your data.',
	},
	terms: {
		title: 'Terms of Service',
		subtitle: 'SpaceBot',
		description: 'Rules and guidelines for using SpaceBot.',
	},
} as const satisfies Record<string, OgCard>;

export type OgCardKey = keyof typeof OG_CARDS;

export const isOgCardKey = (key: unknown): key is OgCardKey =>
	typeof key === 'string' && Object.hasOwn(OG_CARDS, key);

/** The absolute URL of a card image, for `og:image`. */
export const ogImageUrl = (card: OgCardKey) => `${SITE_URL}/og/${card}.png`;

export interface Social {
	card: OgCardKey;
	title: string;
	description: string;
	/**
	 * The page writes its own tags from its own data (a listed server, a document, a profile).
	 * The layout then adds none, so the page never has two sets.
	 */
	own: boolean;
}

interface Route {
	test: RegExp;
	card: OgCardKey;
	title: string;
	description: string;
	own?: boolean;
}

const DEFAULT_DESCRIPTION =
	'A powerful Discord bot platform with custom commands, automations, AI assistant, server analytics, and integrations.';

/** First match wins, so a specific path goes before the section it belongs to. */
const ROUTES: Route[] = [
	{
		test: /^\/$/,
		card: 'home',
		title: 'SpaceBot – Discord Bot Platform',
		description: DEFAULT_DESCRIPTION,
	},
	{
		test: /^\/status\/?$/,
		card: 'status',
		title: 'SpaceBot Status',
		description:
			'Live status of the SpaceBot website, database and bot, with a history of past incidents.',
	},
	{
		test: /^\/servers\/[^/]+\/?$/,
		card: 'servers',
		title: 'Discord Server Browser — SpaceBot',
		description: 'A Discord community that runs SpaceBot.',
		own: true,
	},
	{
		test: /^\/servers\/?$/,
		card: 'servers',
		title: 'Discord Server Browser — SpaceBot',
		description:
			'Browse Discord communities that run on SpaceBot and chose to be listed publicly.',
	},
	{
		test: /^\/docs\/dev\/[^/]+\/?$/,
		card: 'devdocs',
		title: 'Developer Docs – SpaceBot',
		description: 'SpaceBot developer documentation.',
		own: true,
	},
	{
		test: /^\/docs\/dev\/?$/,
		card: 'devdocs',
		title: 'Developer Docs – SpaceBot',
		description: 'The SpaceBot REST API and integrations, for people building on SpaceBot.',
	},
	{
		test: /^\/docs(\/|$)/,
		card: 'docs',
		title: 'Documentation – SpaceBot',
		description:
			'Learn how to set up and use custom commands, automations, integrations, the REST API, and more.',
	},
	{
		test: /^\/privacy\/?$/,
		card: 'privacy',
		title: 'Privacy Policy – SpaceBot',
		description: 'How SpaceBot collects, uses and protects your data.',
	},
	{
		test: /^\/terms\/?$/,
		card: 'terms',
		title: 'Terms of Service – SpaceBot',
		description: 'The rules and guidelines for using SpaceBot.',
	},
	{
		test: /^\/leaderboards\/?$/,
		card: 'leaderboards',
		title: 'SpaceBot Leaderboards',
		description: 'Server leaderboards from the communities that run SpaceBot.',
	},
	{
		test: /^\/ideas\/?$/,
		card: 'ideas',
		title: 'Send an idea – SpaceBot',
		description: 'Tell us how to make SpaceBot better. We read every one.',
	},
	{
		test: /^\/vote\/?$/,
		card: 'vote',
		title: 'Vote for SpaceBot',
		description: 'Help more servers find SpaceBot with a vote or a review.',
	},
	{
		test: /^\/support\/?$/,
		card: 'support',
		title: 'SpaceBot Support',
		description: 'Join the SpaceBot Discord support server for setup help and release updates.',
	},
	{
		test: /^\/invite\/?$/,
		card: 'invite',
		title: 'Invite SpaceBot',
		description:
			'Install the bot with slash commands, context menus, automations, and analytics enabled.',
	},
	{
		test: /^\/login\/?$/,
		card: 'login',
		title: 'Sign in – SpaceBot',
		description: 'Sign in with Discord to access your dashboard.',
	},
	{
		test: /^\/profile\//,
		card: 'profile',
		title: 'Member Profile – SpaceBot',
		description: 'A member profile on a server that runs SpaceBot.',
		own: true,
	},
	{
		test: /^\/(admin|account)(\/|$)/,
		card: 'dashboard',
		title: 'SpaceBot Dashboard',
		description: 'Manage commands, automations and settings for your Discord server.',
	},
];

export function socialFor(pathname: string): Social {
	const path = pathname || '/';
	const hit = ROUTES.find((r) => r.test.test(path));
	if (hit) {
		return {
			card: hit.card,
			title: hit.title,
			description: hit.description,
			own: hit.own === true,
		};
	}
	// A page nobody has described yet still gets the SpaceBot card, not a bare logo.
	return {
		card: 'home',
		title: 'SpaceBot – Discord Bot Platform',
		description: DEFAULT_DESCRIPTION,
		own: false,
	};
}
