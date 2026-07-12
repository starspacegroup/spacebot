<script lang="ts">
	import LegalPage from '$lib/components/LegalPage.svelte';
	import { getLocale } from '$lib/i18n.js';

	const isEs = getLocale() === 'es';
	const effectiveDate = isEs ? '21 de febrero de 2026' : 'February 21, 2026';
	const title = isEs ? 'Política de privacidad' : 'Privacy Policy';

	const toc = isEs
		? [
				{ id: 'introduction', label: 'Introducción' },
				{ id: 'data-controller', label: 'Responsable del tratamiento' },
				{ id: 'information-we-collect', label: 'Información que recopilamos' },
				{ id: 'legal-basis', label: 'Base legal para el tratamiento (RGPD)' },
				{ id: 'how-we-use', label: 'Cómo usamos tu información' },
				{ id: 'data-sharing', label: 'Compartición de datos y servicios de terceros' },
				{ id: 'international-transfers', label: 'Transferencias internacionales de datos' },
				{ id: 'data-retention', label: 'Conservación de datos' },
				{ id: 'data-security', label: 'Almacenamiento y seguridad de datos' },
				{ id: 'your-rights', label: 'Tus derechos' },
				{ id: 'automated-decisions', label: 'Decisiones automatizadas' },
				{ id: 'children', label: 'Privacidad de los menores' },
				{ id: 'do-not-track', label: 'No rastrear' },
				{ id: 'changes', label: 'Cambios en esta política' },
				{ id: 'contact', label: 'Contacto' },
				{ id: 'changelog', label: 'Registro de cambios' },
			]
		: [
				{ id: 'introduction', label: 'Introduction' },
				{ id: 'data-controller', label: 'Data Controller' },
				{ id: 'information-we-collect', label: 'Information We Collect' },
				{ id: 'legal-basis', label: 'Legal Basis for Processing (GDPR)' },
				{ id: 'how-we-use', label: 'How We Use Your Information' },
				{ id: 'data-sharing', label: 'Data Sharing & Third-Party Services' },
				{ id: 'international-transfers', label: 'International Data Transfers' },
				{ id: 'data-retention', label: 'Data Retention' },
				{ id: 'data-security', label: 'Data Storage & Security' },
				{ id: 'your-rights', label: 'Your Rights' },
				{ id: 'automated-decisions', label: 'Automated Decision-Making' },
				{ id: 'children', label: "Children's Privacy" },
				{ id: 'do-not-track', label: 'Do Not Track' },
				{ id: 'changes', label: 'Changes to This Policy' },
				{ id: 'contact', label: 'Contact' },
				{ id: 'changelog', label: 'Changelog' },
			];

	const versions = [{ version: '1.0', date: effectiveDate, current: true }];

	const changelog = [
		{
			version: '1.0',
			date: effectiveDate,
			changes: [isEs ? 'Política de privacidad inicial' : 'Initial privacy policy'],
		},
	];
</script>

<LegalPage {title} {toc} {versions} {changelog}>
	{#if isEs}
		<section>
			<h2 id="introduction">1. Introducción</h2>
			<p>
				Esta Política de privacidad describe cómo Starspace Group («Starspace», «nosotros» o
				«nuestro»), operador de SpaceBot («el Servicio»), recopila, usa, almacena y protege
				la información cuando usas nuestra plataforma de bots para Discord y el panel web
				asociado. Al usar el Servicio, reconoces que has leído y entendido esta Política de
				privacidad.
			</p>
			<p>
				SpaceBot funciona como una aplicación de Discord sujeta a los
				<a
					href="https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service"
					target="_blank"
					rel="noopener noreferrer"
					>Términos de servicio para desarrolladores de Discord</a
				>
				y a la
				<a
					href="https://discord.com/developers/docs/policies-and-agreements/developer-policy"
					target="_blank"
					rel="noopener noreferrer">Política para desarrolladores de Discord</a
				>. Te animamos a revisar también la
				<a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer"
					>Política de privacidad de Discord</a
				>
				para entender cómo Discord recopila y trata tus datos.
			</p>
		</section>

		<section>
			<h2 id="data-controller">2. Responsable del tratamiento</h2>
			<p>
				Starspace Group es el responsable del tratamiento de los datos personales procesados
				a través del Servicio. Para consultas sobre privacidad, puedes contactarnos mediante
				los métodos descritos en la sección de Contacto más abajo.
			</p>
		</section>

		<section>
			<h2 id="information-we-collect">3. Información que recopilamos</h2>

			<h3>3.1 Información de Discord OAuth2</h3>
			<p>
				Cuando inicias sesión mediante Discord OAuth2, solicitamos los siguientes permisos y
				recibimos:
			</p>
			<ul>
				<li>
					<strong>identify</strong> &mdash; Tu ID de usuario de Discord, nombre de usuario,
					nombre para mostrar, avatar y discriminador
				</li>
				<li>
					<strong>guilds</strong> &mdash; Una lista de servidores de Discord de los que eres
					miembro, incluidos tus permisos en cada uno
				</li>
			</ul>
			<p>
				No solicitamos ni recibimos tu dirección de correo electrónico, contraseña ni
				mensajes privados a través de Discord OAuth2.
			</p>

			<h3>3.2 Datos del servidor de Discord</h3>
			<p>
				Cuando SpaceBot está instalado y activo en un servidor de Discord, podemos procesar:
			</p>
			<ul>
				<li>
					Metadatos del servidor: ID del servidor, nombre, icono, número de miembros,
					número de canales, número de roles, número de emojis, número de mejoras (boosts)
					y nivel de mejora
				</li>
				<li>
					Metadatos de eventos: tipos de evento (p. ej., entrada/salida de miembros,
					actualizaciones de roles, cambios de canal), IDs de autor, nombres de autor, IDs
					de objetivo, nombres de objetivo, IDs de canal y nombres de canal
				</li>
				<li>
					Datos de uso de comandos e interacción (comandos de barra, interacciones de menú
					contextual)
				</li>
				<li>Asignaciones de roles de los miembros para la comprobación de permisos</li>
			</ul>
			<p>
				<strong>No leemos ni almacenamos el contenido de los mensajes.</strong> SpaceBot no usa
				el intent privilegiado MESSAGE_CONTENT de Discord. Los registros de eventos capturan metadatos
				sobre los eventos (como el hecho de que se envió un mensaje), pero no el contenido de
				los mensajes.
			</p>

			<h3>3.3 Estadísticas del servidor</h3>
			<p>
				Registramos periódicamente estadísticas agregadas del servidor (número de miembros,
				de canales, de roles, niveles de mejora) para ofrecer analíticas históricas en el
				panel de administración. Estas estadísticas se asocian con IDs de servidor, no con
				usuarios individuales.
			</p>

			<h3>3.4 Automatizaciones y comandos personalizados</h3>
			<p>
				Los administradores de servidor pueden crear automatizaciones y comandos
				personalizados a través del panel. Estas configuraciones (condiciones
				desencadenantes, definiciones de acciones, plantillas de respuesta) se almacenan
				asociadas al ID del servidor.
			</p>

			<h3>3.5 Interacciones con la IA</h3>
			<p>
				Si tu servidor usa las funciones de chat con IA de SpaceBot, los mensajes de
				conversación enviados al bot se procesan mediante Cloudflare Workers AI. Estos
				mensajes se procesan en tiempo real y no son almacenados de forma persistente por
				nosotros más allá de la duración de la sesión de conversación.
			</p>

			<h3>3.6 Cookies</h3>
			<p>
				Usamos cookies propias estrictamente necesarias para mantener tu sesión autenticada:
			</p>
			<ul>
				<li><strong>discord_user_id</strong> &mdash; Tu ID de usuario de Discord</li>
				<li><strong>discord_username</strong> &mdash; Tu nombre de usuario de Discord</li>
				<li>
					<strong>discord_global_name</strong> &mdash; Tu nombre para mostrar de Discord
				</li>
				<li><strong>discord_avatar</strong> &mdash; El hash de tu avatar de Discord</li>
				<li><strong>discord_discriminator</strong> &mdash; Tu discriminador de Discord</li>
				<li>
					<strong>discord_access_token</strong> &mdash; Tu token de acceso OAuth2 (usado para
					comunicarnos con la API de Discord en tu nombre)
				</li>
			</ul>
			<p>
				Estas cookies caducan a los 7 días y son esenciales para que el Servicio funcione.
				No usamos cookies de rastreo, cookies publicitarias ni cookies de analítica de
				terceros.
			</p>

			<h3>3.7 Claves de API</h3>
			<p>
				Los administradores de servidor pueden generar claves de API para el acceso
				programático. Estas claves se almacenan de forma segura y se asocian con el servidor
				y con el usuario que las creó.
			</p>
		</section>

		<section>
			<h2 id="legal-basis">4. Base legal para el tratamiento (RGPD)</h2>
			<p>
				Si te encuentras en el Espacio Económico Europeo (EEE), el Reino Unido o Suiza,
				tratamos tus datos personales sobre las siguientes bases legales:
			</p>
			<ul>
				<li>
					<strong>Ejecución de un contrato (art. 6(1)(b) RGPD)</strong> &mdash; Tratamiento
					necesario para prestar el Servicio que has solicitado, incluidas la autenticación
					y la funcionalidad del panel
				</li>
				<li>
					<strong>Intereses legítimos (art. 6(1)(f) RGPD)</strong> &mdash; Tratamiento necesario
					para nuestros intereses legítimos de operar, mantener y mejorar el Servicio, siempre
					que dichos intereses no prevalezcan sobre tus derechos
				</li>
				<li>
					<strong>Consentimiento (art. 6(1)(a) RGPD)</strong> &mdash; Cuando hayas dado tu consentimiento,
					como al autorizar SpaceBot mediante Discord OAuth2. Puedes retirar el consentimiento
					en cualquier momento revocando el acceso de SpaceBot desde la configuración de tu
					cuenta de Discord
				</li>
			</ul>
		</section>

		<section>
			<h2 id="how-we-use">5. Cómo usamos tu información</h2>
			<p>Usamos la información que recopilamos para:</p>
			<ul>
				<li>Autenticarte y autorizar el acceso a tu panel de administración</li>
				<li>
					Ejecutar las automatizaciones, comandos personalizados y webhooks que configures
				</li>
				<li>Mostrar estadísticas del servidor, registros de eventos y analíticas</li>
				<li>Aplicar los controles de permisos dentro del Servicio</li>
				<li>Procesar las interacciones de chat con IA cuando uses esa función</li>
				<li>Mantener, proteger y mejorar el Servicio</li>
				<li>Cumplir con las obligaciones legales</li>
			</ul>
		</section>

		<section>
			<h2 id="data-sharing">6. Compartición de datos y servicios de terceros</h2>
			<p>
				<strong>No</strong> vendemos, alquilamos, intercambiamos ni compartimos de ningún otro
				modo tu información personal con terceros para sus fines de marketing.
			</p>
			<p>
				Solo compartimos datos con las siguientes categorías de proveedores de servicios,
				estrictamente en la medida necesaria para operar el Servicio:
			</p>
			<ul>
				<li>
					<strong>Discord</strong> &mdash; Nos comunicamos con la
					<a
						href="https://discord.com/developers/docs/intro"
						target="_blank"
						rel="noopener noreferrer">API de Discord</a
					>
					para autenticar usuarios, obtener datos del servidor y realizar acciones del bot.
					Los datos que compartes con Discord se rigen por la
					<a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer"
						>Política de privacidad de Discord</a
					>.
				</li>
				<li>
					<strong>Cloudflare</strong> &mdash; El Servicio se aloja en la infraestructura
					de Cloudflare (Cloudflare Workers/Pages y bases de datos D1). Los datos
					procesados a través de Cloudflare están sujetos a la
					<a
						href="https://www.cloudflare.com/privacypolicy/"
						target="_blank"
						rel="noopener noreferrer">Política de privacidad de Cloudflare</a
					>.
				</li>
				<li>
					<strong>Cloudflare Workers AI</strong> &mdash; Si usas las funciones de chat con IA,
					los datos de conversación se procesan a través de los servicios de inferencia de IA
					de Cloudflare.
				</li>
			</ul>
			<p>
				También podemos divulgar información si así lo exige la ley, una normativa, un
				proceso legal o una solicitud gubernamental, o para proteger los derechos, la
				propiedad o la seguridad nuestros, de nuestros usuarios o del público.
			</p>
		</section>

		<section>
			<h2 id="international-transfers">7. Transferencias internacionales de datos</h2>
			<p>
				El Servicio se aloja en la red global de Cloudflare. Tus datos pueden procesarse en
				países distintos de tu país de residencia, incluidos Estados Unidos y otras
				jurisdicciones donde Cloudflare opera nodos edge. Cuando los datos se transfieren
				fuera del EEE, el Reino Unido o Suiza, nos basamos en los acuerdos de tratamiento de
				datos de Cloudflare y en las garantías adecuadas, incluidas las Cláusulas
				Contractuales Tipo (CCT) cuando corresponda, para garantizar una protección adecuada
				de tus datos.
			</p>
		</section>

		<section>
			<h2 id="data-retention">8. Conservación de datos</h2>
			<ul>
				<li>
					<strong>Datos de autenticación</strong> &mdash; Las cookies de sesión caducan a los
					7 días. Los tokens OAuth2 no se almacenan en el servidor más allá de la cookie.
				</li>
				<li>
					<strong>Registros de eventos</strong> &mdash; Se conservan mientras el servidor permanezca
					activo en el Servicio. Los administradores del servidor pueden solicitar su eliminación.
				</li>
				<li>
					<strong>Estadísticas del servidor</strong> &mdash; Las estadísticas históricas se
					conservan mientras el servidor permanezca activo. Las estadísticas agregadas pueden
					conservarse indefinidamente.
				</li>
				<li>
					<strong>Automatizaciones y comandos</strong> &mdash; Se conservan hasta que el administrador
					del servidor los elimine o hasta que se retire el bot del servidor.
				</li>
				<li>
					<strong>Claves de API</strong> &mdash; Se conservan hasta que el administrador del
					servidor las revoque o hasta que se retire el bot.
				</li>
			</ul>
			<p>
				Cuando se retira SpaceBot de un servidor, los administradores del servidor pueden
				solicitar la eliminación completa de todos los datos asociados. Procesaremos dichas
				solicitudes en un plazo de 30 días.
			</p>
		</section>

		<section>
			<h2 id="data-security">9. Almacenamiento y seguridad de datos</h2>
			<p>
				Los datos se almacenan en bases de datos Cloudflare D1 con cifrado en reposo y en
				tránsito. Implementamos medidas de seguridad técnicas y organizativas razonables,
				entre ellas:
			</p>
			<ul>
				<li>Conexiones cifradas (HTTPS/TLS) para todos los datos en tránsito</li>
				<li>Controles de acceso y autenticación para el panel de administración</li>
				<li>
					Comprobaciones de permisos basadas en roles para el acceso a los datos del
					servidor
				</li>
				<li>
					Atributos de cookie seguros (HttpOnly, SameSite) para la gestión de la sesión
				</li>
			</ul>
			<p>
				A pesar de estas medidas, ningún método de transmisión o almacenamiento electrónico
				es 100 % seguro. No podemos garantizar la seguridad absoluta de tus datos.
			</p>
		</section>

		<section>
			<h2 id="your-rights">10. Tus derechos</h2>

			<h3>10.1 Derechos generales (todos los usuarios)</h3>
			<p>Independientemente de tu ubicación, tienes derecho a:</p>
			<ul>
				<li>Acceder a los datos personales que tenemos sobre ti</li>
				<li>Solicitar la corrección de datos inexactos</li>
				<li>Solicitar la eliminación de tus datos</li>
				<li>Retirar SpaceBot de tu servidor para detener la recopilación de datos</li>
				<li>
					Revocar el acceso OAuth2 de SpaceBot desde tu
					<a
						href="https://discord.com/settings/authorized-apps"
						target="_blank"
						rel="noopener noreferrer"
						>configuración de aplicaciones autorizadas de Discord</a
					>
				</li>
			</ul>

			<h3>10.2 Espacio Económico Europeo, Reino Unido y Suiza (RGPD/RGPD del Reino Unido)</h3>
			<p>Si te encuentras en el EEE, el Reino Unido o Suiza, además tienes derecho a:</p>
			<ul>
				<li>
					<strong>Portabilidad de los datos</strong> &mdash; Recibir tus datos personales en
					un formato estructurado, de uso común y legible por máquina
				</li>
				<li>
					<strong>Limitación del tratamiento</strong> &mdash; Solicitar que limitemos el tratamiento
					de tus datos personales en determinadas circunstancias
				</li>
				<li>
					<strong>Oposición al tratamiento</strong> &mdash; Oponerte al tratamiento basado en
					intereses legítimos
				</li>
				<li>
					<strong>Retirada del consentimiento</strong> &mdash; Cuando el tratamiento se base
					en el consentimiento, retirarlo en cualquier momento sin que ello afecte a la licitud
					del tratamiento previo
				</li>
				<li>
					<strong>Presentar una reclamación</strong> &mdash; Presentar una reclamación ante
					tu autoridad local de control de protección de datos
				</li>
			</ul>

			<h3>10.3 Residentes de California (CCPA/CPRA)</h3>
			<p>Si resides en California, tienes derecho a:</p>
			<ul>
				<li>
					<strong>Saber</strong> &mdash; Solicitar la divulgación de las categorías y los elementos
					concretos de información personal que hemos recopilado sobre ti
				</li>
				<li>
					<strong>Eliminar</strong> &mdash; Solicitar la eliminación de tu información personal
				</li>
				<li>
					<strong>Excluirte de la venta</strong> &mdash; No vendemos tu información personal.
					No compartimos tu información personal para publicidad conductual entre contextos.
				</li>
				<li>
					<strong>No discriminación</strong> &mdash; No te discriminaremos por ejercer tus derechos
					de privacidad
				</li>
			</ul>

			<h3>10.4 Brasil (LGPD)</h3>
			<p>Si te encuentras en Brasil, tienes derecho a:</p>
			<ul>
				<li>Confirmar la existencia del tratamiento de tus datos</li>
				<li>Acceder a tus datos, corregirlos o anonimizarlos</li>
				<li>Solicitar la portabilidad de los datos</li>
				<li>Solicitar la eliminación de los datos tratados con tu consentimiento</li>
				<li>
					Obtener información sobre las entidades públicas y privadas con las que se han
					compartido tus datos
				</li>
				<li>Revocar el consentimiento en cualquier momento</li>
			</ul>

			<h3>10.5 Otras jurisdicciones</h3>
			<p>
				Si te encuentras en otra jurisdicción que otorgue derechos de privacidad específicos
				(incluidos, entre otros, Canadá bajo PIPEDA, Australia bajo la Privacy Act, Japón
				bajo APPI, Corea del Sur bajo PIPA u otras leyes aplicables), respetaremos esos
				derechos en la medida en que lo exija la ley aplicable. Contáctanos para ejercer tus
				derechos.
			</p>

			<h3>10.6 Ejercicio de tus derechos</h3>
			<p>
				Para ejercer cualquiera de los derechos anteriores, contáctanos usando los métodos
				de la sección de Contacto más abajo. Responderemos a las solicitudes verificadas en
				un plazo de 30 días (o el plazo aplicable exigido por tu ley local). Podemos pedirte
				que verifiques tu identidad antes de procesar tu solicitud.
			</p>
		</section>

		<section>
			<h2 id="automated-decisions">11. Decisiones automatizadas</h2>
			<p>
				El Servicio usa procesamiento automatizado para ejecutar las automatizaciones y
				comandos configurados por los administradores del servidor (p. ej., reglas de
				automoderación, acciones desencadenadas por eventos). Estos procesos automatizados
				funcionan según reglas establecidas explícitamente por los administradores del
				servidor y no implican la elaboración de perfiles ni decisiones automatizadas que
				produzcan efectos jurídicos o efectos igualmente significativos sobre las personas.
			</p>
		</section>

		<section>
			<h2 id="children">12. Privacidad de los menores</h2>
			<p>
				El Servicio no está dirigido a menores de 13 años (o la edad mínima exigida en tu
				jurisdicción) y no recopilamos conscientemente información personal de ellos. Esto
				se ajusta a los propios requisitos de edad de Discord. En el Espacio Económico
				Europeo, la edad mínima es 16 (o menor si tu estado miembro ha fijado una edad
				inferior, pero nunca por debajo de 13). En Corea del Sur, la edad mínima es 14.
			</p>
			<p>
				Si tenemos conocimiento de que hemos recopilado datos personales de un menor por
				debajo de la edad mínima aplicable sin consentimiento parental verificado, tomaremos
				medidas para eliminar esa información con prontitud. Si crees que hemos recopilado
				datos de un menor, contáctanos de inmediato.
			</p>
		</section>

		<section>
			<h2 id="do-not-track">13. No rastrear</h2>
			<p>
				No rastreamos a los usuarios en sitios web de terceros. El Servicio no responde a
				las señales «No rastrear» (DNT) del navegador porque no realizamos el tipo de
				rastreo entre sitios que dichas señales están diseñadas para prevenir.
			</p>
		</section>

		<section>
			<h2 id="changes">14. Cambios en esta política</h2>
			<p>
				Podemos actualizar esta Política de privacidad de vez en cuando. Notificaremos a los
				usuarios los cambios importantes actualizando la fecha de «Última actualización» en
				la parte superior de esta página. Para cambios significativos, haremos esfuerzos
				razonables para proporcionar un aviso adicional (como a través de nuestro
				repositorio de GitHub o del servidor de soporte de Discord). Tu uso continuado del
				Servicio después de que los cambios entren en vigor constituye tu aceptación de la
				política revisada.
			</p>
		</section>

		<section>
			<h2 id="contact">15. Contacto</h2>
			<p>
				Si tienes preguntas, inquietudes o solicitudes sobre esta Política de privacidad o
				sobre nuestras prácticas de datos, contáctanos a través de:
			</p>
			<ul>
				<li>
					<strong>GitHub:</strong>
					<a
						href="https://github.com/starspacegroup/spacebot/issues"
						target="_blank"
						rel="noopener noreferrer">github.com/starspacegroup/spacebot/issues</a
					>
				</li>
				<li>
					<strong>Correo electrónico:</strong>
					<a href="mailto:spacebot@starspace.group">spacebot@starspace.group</a>
				</li>
			</ul>
			<p>
				Para los usuarios del EEE, el Reino Unido o Suiza, también tienes derecho a
				presentar una reclamación ante tu autoridad local de control de protección de datos.
			</p>
		</section>
	{:else}
		<section>
			<h2 id="introduction">1. Introduction</h2>
			<p>
				This Privacy Policy describes how Starspace Group ("Starspace", "we", "us", or
				"our"), the operator of SpaceBot ("the Service"), collects, uses, stores, and
				protects information when you use our Discord bot platform and associated web
				dashboard. By using the Service, you acknowledge that you have read and understood
				this Privacy Policy.
			</p>
			<p>
				SpaceBot operates as a Discord application subject to
				<a
					href="https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service"
					target="_blank"
					rel="noopener noreferrer">Discord's Developer Terms of Service</a
				>
				and
				<a
					href="https://discord.com/developers/docs/policies-and-agreements/developer-policy"
					target="_blank"
					rel="noopener noreferrer">Discord's Developer Policy</a
				>. We encourage you to also review
				<a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer"
					>Discord's Privacy Policy</a
				>
				to understand how Discord collects and processes your data.
			</p>
		</section>

		<section>
			<h2 id="data-controller">2. Data Controller</h2>
			<p>
				Starspace Group is the data controller responsible for the personal data processed
				through the Service. For privacy inquiries, you may contact us via the methods
				described in the Contact section below.
			</p>
		</section>

		<section>
			<h2 id="information-we-collect">3. Information We Collect</h2>

			<h3>3.1 Information from Discord OAuth2</h3>
			<p>When you log in via Discord OAuth2, we request the following scopes and receive:</p>
			<ul>
				<li>
					<strong>identify</strong> &mdash; Your Discord user ID, username, display name, avatar,
					and discriminator
				</li>
				<li>
					<strong>guilds</strong> &mdash; A list of Discord servers (guilds) you are a member
					of, including your permissions in each
				</li>
			</ul>
			<p>
				We do not request or receive your email address, password, or private messages
				through Discord OAuth2.
			</p>

			<h3>3.2 Discord Server Data</h3>
			<p>When SpaceBot is installed and active in a Discord server, we may process:</p>
			<ul>
				<li>
					Server (guild) metadata: server ID, name, icon, member count, channel count,
					role count, emoji count, boost count, and boost level
				</li>
				<li>
					Event metadata: event types (e.g., member join/leave, role updates, channel
					changes), actor IDs, actor usernames, target IDs, target names, channel IDs, and
					channel names
				</li>
				<li>
					Command usage and interaction data (slash commands, context menu interactions)
				</li>
				<li>Member role assignments for permission checking</li>
			</ul>
			<p>
				<strong>We do not read or store message content.</strong> SpaceBot does not use the Discord
				MESSAGE_CONTENT privileged intent. Event logs capture metadata about events (such as the
				fact that a message was sent), but not the content of messages.
			</p>

			<h3>3.3 Server Statistics</h3>
			<p>
				We periodically record aggregated server statistics (member counts, channel counts,
				role counts, boost levels) to provide historical analytics in the admin dashboard.
				These statistics are associated with server IDs, not individual users.
			</p>

			<h3>3.4 Automations &amp; Custom Commands</h3>
			<p>
				Server administrators may create automations and custom commands through the
				dashboard. These configurations (trigger conditions, action definitions, response
				templates) are stored in association with the server ID.
			</p>

			<h3>3.5 AI Interactions</h3>
			<p>
				If your server uses SpaceBot's AI chat features, conversation messages sent to the
				bot are processed via Cloudflare Workers AI. These messages are processed in real
				time and are not persistently stored by us beyond the duration of the conversation
				session.
			</p>

			<h3>3.6 Cookies</h3>
			<p>
				We use strictly necessary first-party cookies to maintain your authenticated
				session:
			</p>
			<ul>
				<li><strong>discord_user_id</strong> &mdash; Your Discord user ID</li>
				<li><strong>discord_username</strong> &mdash; Your Discord username</li>
				<li><strong>discord_global_name</strong> &mdash; Your Discord display name</li>
				<li><strong>discord_avatar</strong> &mdash; Your Discord avatar hash</li>
				<li><strong>discord_discriminator</strong> &mdash; Your Discord discriminator</li>
				<li>
					<strong>discord_access_token</strong> &mdash; Your OAuth2 access token (used to communicate
					with Discord's API on your behalf)
				</li>
			</ul>
			<p>
				These cookies expire after 7 days and are essential for the Service to function. We
				do not use tracking cookies, advertising cookies, or third-party analytics cookies.
			</p>

			<h3>3.7 API Keys</h3>
			<p>
				Server administrators may generate API keys for programmatic access. These keys are
				stored securely and are associated with the server and the user who created them.
			</p>
		</section>

		<section>
			<h2 id="legal-basis">4. Legal Basis for Processing (GDPR)</h2>
			<p>
				If you are located in the European Economic Area (EEA), United Kingdom, or
				Switzerland, we process your personal data on the following legal bases:
			</p>
			<ul>
				<li>
					<strong>Contract performance (Art. 6(1)(b) GDPR)</strong> &mdash; Processing necessary
					to provide the Service you have requested, including authentication and dashboard
					functionality
				</li>
				<li>
					<strong>Legitimate interests (Art. 6(1)(f) GDPR)</strong> &mdash; Processing necessary
					for our legitimate interests in operating, maintaining, and improving the Service,
					provided these interests are not overridden by your rights
				</li>
				<li>
					<strong>Consent (Art. 6(1)(a) GDPR)</strong> &mdash; Where you have given consent,
					such as when authorizing SpaceBot via Discord OAuth2. You may withdraw consent at
					any time by revoking SpaceBot's access through your Discord account settings
				</li>
			</ul>
		</section>

		<section>
			<h2 id="how-we-use">5. How We Use Your Information</h2>
			<p>We use the information we collect to:</p>
			<ul>
				<li>Authenticate you and authorize access to your admin dashboard</li>
				<li>Execute automations, custom commands, and webhooks you configure</li>
				<li>Display server statistics, event logs, and analytics</li>
				<li>Enforce permission controls within the Service</li>
				<li>Process AI chat interactions when you use that feature</li>
				<li>Maintain, protect, and improve the Service</li>
				<li>Comply with legal obligations</li>
			</ul>
		</section>

		<section>
			<h2 id="data-sharing">6. Data Sharing &amp; Third-Party Services</h2>
			<p>
				We do <strong>not</strong> sell, rent, trade, or otherwise share your personal information
				with third parties for their marketing purposes.
			</p>
			<p>
				We share data only with the following categories of service providers, strictly as
				necessary to operate the Service:
			</p>
			<ul>
				<li>
					<strong>Discord</strong> &mdash; We communicate with
					<a
						href="https://discord.com/developers/docs/intro"
						target="_blank"
						rel="noopener noreferrer">Discord's API</a
					>
					to authenticate users, retrieve server data, and perform bot actions. Your data shared
					with Discord is governed by
					<a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer"
						>Discord's Privacy Policy</a
					>.
				</li>
				<li>
					<strong>Cloudflare</strong> &mdash; The Service is hosted on Cloudflare's
					infrastructure (Cloudflare Workers/Pages and D1 databases). Data processed
					through Cloudflare is subject to
					<a
						href="https://www.cloudflare.com/privacypolicy/"
						target="_blank"
						rel="noopener noreferrer">Cloudflare's Privacy Policy</a
					>.
				</li>
				<li>
					<strong>Cloudflare Workers AI</strong> &mdash; If you use AI chat features, conversation
					data is processed through Cloudflare's AI inference services.
				</li>
			</ul>
			<p>
				We may also disclose information if required by law, regulation, legal process, or
				governmental request, or to protect the rights, property, or safety of us, our
				users, or the public.
			</p>
		</section>

		<section>
			<h2 id="international-transfers">7. International Data Transfers</h2>
			<p>
				The Service is hosted on Cloudflare's global network. Your data may be processed in
				countries other than your country of residence, including the United States and
				other jurisdictions where Cloudflare operates edge nodes. Where data is transferred
				outside the EEA, UK, or Switzerland, we rely on Cloudflare's data processing
				agreements and appropriate safeguards, including Standard Contractual Clauses (SCCs)
				where applicable, to ensure adequate protection of your data.
			</p>
		</section>

		<section>
			<h2 id="data-retention">8. Data Retention</h2>
			<ul>
				<li>
					<strong>Authentication data</strong> &mdash; Session cookies expire after 7 days.
					OAuth2 tokens are not stored server-side beyond the cookie.
				</li>
				<li>
					<strong>Event logs</strong> &mdash; Retained for as long as the server remains active
					on the Service. Server administrators may request deletion.
				</li>
				<li>
					<strong>Server statistics</strong> &mdash; Historical statistics are retained for
					as long as the server remains active. Aggregated statistics may be retained indefinitely.
				</li>
				<li>
					<strong>Automations &amp; commands</strong> &mdash; Retained until deleted by the
					server administrator or until the bot is removed from the server.
				</li>
				<li>
					<strong>API keys</strong> &mdash; Retained until revoked by the server administrator
					or until the bot is removed.
				</li>
			</ul>
			<p>
				When SpaceBot is removed from a server, server administrators may request complete
				deletion of all associated data. We will process such requests within 30 days.
			</p>
		</section>

		<section>
			<h2 id="data-security">9. Data Storage &amp; Security</h2>
			<p>
				Data is stored in Cloudflare D1 databases with encryption at rest and in transit. We
				implement reasonable technical and organizational security measures including:
			</p>
			<ul>
				<li>Encrypted connections (HTTPS/TLS) for all data in transit</li>
				<li>Access controls and authentication for the admin dashboard</li>
				<li>Role-based permission checks for server data access</li>
				<li>Secure cookie attributes (HttpOnly, SameSite) for session management</li>
			</ul>
			<p>
				Despite these measures, no method of electronic transmission or storage is 100%
				secure. We cannot guarantee absolute security of your data.
			</p>
		</section>

		<section>
			<h2 id="your-rights">10. Your Rights</h2>

			<h3>10.1 General Rights (All Users)</h3>
			<p>Regardless of your location, you have the right to:</p>
			<ul>
				<li>Access the personal data we hold about you</li>
				<li>Request correction of inaccurate data</li>
				<li>Request deletion of your data</li>
				<li>Remove SpaceBot from your server to stop further data collection</li>
				<li>
					Revoke SpaceBot's OAuth2 access through your
					<a
						href="https://discord.com/settings/authorized-apps"
						target="_blank"
						rel="noopener noreferrer">Discord Authorized Apps settings</a
					>
				</li>
			</ul>

			<h3>10.2 European Economic Area, UK &amp; Switzerland (GDPR/UK GDPR)</h3>
			<p>
				If you are located in the EEA, UK, or Switzerland, you additionally have the right
				to:
			</p>
			<ul>
				<li>
					<strong>Data portability</strong> &mdash; Receive your personal data in a structured,
					commonly used, machine-readable format
				</li>
				<li>
					<strong>Restriction of processing</strong> &mdash; Request that we restrict processing
					of your personal data under certain circumstances
				</li>
				<li>
					<strong>Object to processing</strong> &mdash; Object to processing based on legitimate
					interests
				</li>
				<li>
					<strong>Withdraw consent</strong> &mdash; Where processing is based on consent, withdraw
					that consent at any time without affecting the lawfulness of prior processing
				</li>
				<li>
					<strong>Lodge a complaint</strong> &mdash; File a complaint with your local data protection
					supervisory authority
				</li>
			</ul>

			<h3>10.3 California Residents (CCPA/CPRA)</h3>
			<p>If you are a California resident, you have the right to:</p>
			<ul>
				<li>
					<strong>Know</strong> &mdash; Request disclosure of the categories and specific pieces
					of personal information we have collected about you
				</li>
				<li>
					<strong>Delete</strong> &mdash; Request deletion of your personal information
				</li>
				<li>
					<strong>Opt-out of sale</strong> &mdash; We do not sell your personal information.
					We do not share your personal information for cross-context behavioral advertising.
				</li>
				<li>
					<strong>Non-discrimination</strong> &mdash; We will not discriminate against you for
					exercising your privacy rights
				</li>
			</ul>

			<h3>10.4 Brazil (LGPD)</h3>
			<p>If you are located in Brazil, you have the right to:</p>
			<ul>
				<li>Confirm the existence of processing of your data</li>
				<li>Access, correct, or anonymize your data</li>
				<li>Request data portability</li>
				<li>Request deletion of data processed with your consent</li>
				<li>
					Obtain information about public and private entities with which your data has
					been shared
				</li>
				<li>Revoke consent at any time</li>
			</ul>

			<h3>10.5 Other Jurisdictions</h3>
			<p>
				If you are located in another jurisdiction that grants specific privacy rights
				(including but not limited to Canada under PIPEDA, Australia under the Privacy Act,
				Japan under APPI, South Korea under PIPA, or other applicable laws), we will respect
				those rights to the extent required by applicable law. Please contact us to exercise
				your rights.
			</p>

			<h3>10.6 Exercising Your Rights</h3>
			<p>
				To exercise any of the above rights, please contact us using the methods in the
				Contact section below. We will respond to verified requests within 30 days (or the
				applicable timeframe required by your local law). We may ask you to verify your
				identity before processing your request.
			</p>
		</section>

		<section>
			<h2 id="automated-decisions">11. Automated Decision-Making</h2>
			<p>
				The Service uses automated processing to execute automations and commands configured
				by server administrators (e.g., auto-moderation rules, event-triggered actions).
				These automated processes operate based on rules explicitly set by server
				administrators and do not involve profiling or automated decision-making that
				produces legal effects or similarly significant effects on individuals.
			</p>
		</section>

		<section>
			<h2 id="children">12. Children's Privacy</h2>
			<p>
				The Service is not directed at, and we do not knowingly collect personal information
				from, children under the age of 13 (or the minimum age required in your
				jurisdiction). This aligns with Discord's own age requirements. In the European
				Economic Area, the minimum age is 16 (or lower if your member state has set a lower
				age, but no lower than 13). In South Korea, the minimum age is 14.
			</p>
			<p>
				If we become aware that we have collected personal data from a child below the
				applicable minimum age without verified parental consent, we will take steps to
				delete that information promptly. If you believe we have collected data from a
				child, please contact us immediately.
			</p>
		</section>

		<section>
			<h2 id="do-not-track">13. Do Not Track</h2>
			<p>
				We do not track users across third-party websites. The Service does not respond to
				"Do Not Track" (DNT) browser signals because we do not engage in the type of
				cross-site tracking that such signals are designed to prevent.
			</p>
		</section>

		<section>
			<h2 id="changes">14. Changes to This Policy</h2>
			<p>
				We may update this Privacy Policy from time to time. We will notify users of
				material changes by updating the "Last updated" date at the top of this page. For
				significant changes, we will make reasonable efforts to provide additional notice
				(such as via our GitHub repository or Discord support server). Your continued use of
				the Service after changes become effective constitutes your acceptance of the
				revised policy.
			</p>
		</section>

		<section>
			<h2 id="contact">15. Contact</h2>
			<p>
				If you have questions, concerns, or requests regarding this Privacy Policy or our
				data practices, please contact us via:
			</p>
			<ul>
				<li>
					<strong>GitHub:</strong>
					<a
						href="https://github.com/starspacegroup/spacebot/issues"
						target="_blank"
						rel="noopener noreferrer">github.com/starspacegroup/spacebot/issues</a
					>
				</li>
				<li>
					<strong>Email:</strong>
					<a href="mailto:spacebot@starspace.group">spacebot@starspace.group</a>
				</li>
			</ul>
			<p>
				For users in the EEA, UK, or Switzerland, you also have the right to lodge a
				complaint with your local data protection supervisory authority.
			</p>
		</section>
	{/if}
</LegalPage>
