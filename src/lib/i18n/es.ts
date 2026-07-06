// Spanish catalog. Mirror of en.ts — keep keys in sync.
export const es: Record<string, string> = {
	// --- Global chrome ---
	'language.label': 'Idioma',
	'nav.pricing': 'Precios',
	'nav.login': 'Iniciar sesión',
	'nav.invite': 'Invitar',
	'nav.support': 'Soporte',
	'nav.vote': 'Votar',
	'nav.leaderboards': 'Clasificaciones',
	'nav.docs': 'Documentación',
	'nav.openCommandPalette': 'Abrir paleta de comandos',

	'userMenu.dashboard': 'Panel',
	'userMenu.account': 'Cuenta',
	'userMenu.superadmin': 'Superadministrador',
	'userMenu.logout': 'Cerrar sesión',

	'footer.tagline': 'SpaceBot por',
	'footer.terms': 'Términos del servicio',
	'footer.privacy': 'Política de privacidad',
	'footer.github': 'GitHub',

	// --- Common ---
	'common.loading': 'Cargando…',
	'common.comingSoon': 'Próximamente',
	'common.learnMore': 'Más información',
	'common.getStarted': 'Comenzar',
	'common.backHome': 'Volver al inicio',

	// --- Public utility pages ---
	'public.invite.title': 'Invitar a SpaceBot',
	'public.support.title': 'Servidor de soporte',
	'public.vote.title': 'Votos y reseñas',
	'public.disabled': 'Este enlace todavía no está configurado.',
	'public.setup': 'Define la variable de entorno indicada para activar esta acción.',
	'profile.title': 'Perfil de usuario',
	'settings.branding': 'Marca personalizada',

	// Invite page
	'invite.pageTitle': 'Invitar a SpaceBot',
	'invite.eyebrow': 'Instalación en Discord',
	'invite.body':
		'Instala el bot con comandos de barra, menús contextuales, automatizaciones y analíticas activadas.',
	'invite.cta': 'Abrir instalación en Discord',
	'invite.disabledTitle': 'Enlace de invitación desactivado',
	'invite.disabledHint': 'Define DISCORD_CLIENT_ID para activar el botón de instalación pública.',

	// Support page
	'support.pageTitle': 'Soporte de SpaceBot',
	'support.body':
		'Únete al servidor de soporte de SpaceBot en Discord para recibir ayuda con la configuración y novedades de versiones.',
	'support.cta': 'Abrir servidor de soporte',
	'support.disabled': 'Define {envName} para mostrar el enlace del servidor de soporte.',

	// Vote page
	'vote.pageTitle': 'Vota por SpaceBot',
	'vote.vote': 'Votar',
	'vote.review': 'Reseñar',
	'vote.openVoting': 'Abrir página de votación',
	'vote.openReview': 'Abrir página de reseñas',
	'vote.enableVoting': 'Define {envName} para activar la votación.',
	'vote.enableReviews': 'Define {envName} para activar las reseñas.',

	// Leaderboards page
	'leaderboards.pageTitle': 'Clasificaciones de SpaceBot',
	'leaderboards.title': 'Clasificaciones del servidor',
	'leaderboards.body':
		'Las entradas de la clasificación de voz respetan la privacidad: solo se muestran los ID de Discord y el tiempo agregado.',
	'leaderboards.needGuildBefore': 'Añade',
	'leaderboards.needGuildAfter': 'para ver la clasificación de un servidor.',
	'leaderboards.empty': 'Todavía no hay datos de clasificación para este servidor.',
	'leaderboards.rank': 'Puesto',
	'leaderboards.user': 'Usuario',
	'leaderboards.voiceHours': 'Horas de voz',
};
