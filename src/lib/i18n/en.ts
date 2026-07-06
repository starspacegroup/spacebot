// English catalog. Keys are namespaced by surface (nav.*, home.*, …).
// Placeholders use {name} syntax and are filled by t(locale, key, params).
export const en: Record<string, string> = {
	// --- Global chrome ---
	'language.label': 'Language',
	'nav.pricing': 'Pricing',
	'nav.login': 'Login',
	'nav.invite': 'Invite',
	'nav.support': 'Support',
	'nav.vote': 'Vote',
	'nav.leaderboards': 'Leaderboards',
	'nav.docs': 'Docs',
	'nav.openCommandPalette': 'Open command palette',

	'userMenu.dashboard': 'Dashboard',
	'userMenu.account': 'Account',
	'userMenu.superadmin': 'Superadmin',
	'userMenu.logout': 'Logout',

	'footer.tagline': 'SpaceBot by',
	'footer.terms': 'Terms of Service',
	'footer.privacy': 'Privacy Policy',
	'footer.github': 'GitHub',

	// --- Common ---
	'common.loading': 'Loading…',
	'common.comingSoon': 'Coming soon',
	'common.learnMore': 'Learn more',
	'common.getStarted': 'Get started',
	'common.backHome': 'Back to home',

	// --- Public utility pages ---
	'public.invite.title': 'Invite SpaceBot',
	'public.support.title': 'Support server',
	'public.vote.title': 'Vote and reviews',
	'public.disabled': 'This link is not configured yet.',
	'public.setup': 'Set the environment variable shown below to enable this action.',
	'profile.title': 'User profile',
	'settings.branding': 'Custom branding',

	// Invite page
	'invite.pageTitle': 'Invite SpaceBot',
	'invite.eyebrow': 'Discord install',
	'invite.body':
		'Install the bot with slash commands, context menus, automations, and analytics enabled.',
	'invite.cta': 'Open Discord install',
	'invite.disabledTitle': 'Invite link disabled',
	'invite.disabledHint': 'Set DISCORD_CLIENT_ID to enable the public install CTA.',

	// Support page
	'support.pageTitle': 'SpaceBot Support',
	'support.body': 'Join the SpaceBot Discord support server for setup help and release updates.',
	'support.cta': 'Open support server',
	'support.disabled': 'Set {envName} to show the support server link.',

	// Vote page
	'vote.pageTitle': 'Vote for SpaceBot',
	'vote.vote': 'Vote',
	'vote.review': 'Review',
	'vote.openVoting': 'Open voting page',
	'vote.openReview': 'Open review page',
	'vote.enableVoting': 'Set {envName} to enable voting.',
	'vote.enableReviews': 'Set {envName} to enable reviews.',

	// Leaderboards page
	'leaderboards.pageTitle': 'SpaceBot Leaderboards',
	'leaderboards.title': 'Server leaderboards',
	'leaderboards.body':
		'Voice leaderboard entries are privacy-safe: only Discord IDs and aggregate time are shown.',
	'leaderboards.needGuildBefore': 'Add',
	'leaderboards.needGuildAfter': 'to view a server leaderboard.',
	'leaderboards.empty': 'No leaderboard data is available for this server yet.',
	'leaderboards.rank': 'Rank',
	'leaderboards.user': 'User',
	'leaderboards.voiceHours': 'Voice hours',
};
