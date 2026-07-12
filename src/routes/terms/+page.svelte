<script lang="ts">
	import LegalPage from '$lib/components/LegalPage.svelte';
	import { getLocale } from '$lib/i18n.js';

	const isEs = getLocale() === 'es';
	const effectiveDate = isEs ? '21 de febrero de 2026' : 'February 21, 2026';
	const title = isEs ? 'Términos del servicio' : 'Terms of Service';

	const toc = isEs
		? [
				{ id: 'acceptance', label: 'Aceptación de los términos' },
				{ id: 'eligibility', label: 'Elegibilidad' },
				{ id: 'description', label: 'Descripción del servicio' },
				{ id: 'accounts', label: 'Cuentas de usuario y autenticación' },
				{ id: 'acceptable-use', label: 'Uso aceptable' },
				{
					id: 'intellectual-property',
					label: 'Contenido del usuario y propiedad intelectual',
				},
				{ id: 'api-access', label: 'Acceso a la API' },
				{ id: 'availability', label: 'Disponibilidad del servicio y modificaciones' },
				{ id: 'warranties', label: 'Renuncia de garantías' },
				{ id: 'liability', label: 'Limitación de responsabilidad' },
				{ id: 'indemnification', label: 'Indemnización' },
				{ id: 'termination', label: 'Rescisión' },
				{ id: 'privacy', label: 'Privacidad' },
				{ id: 'governing-law', label: 'Ley aplicable' },
				{ id: 'disputes', label: 'Resolución de disputas' },
				{ id: 'changes', label: 'Cambios en los términos' },
				{ id: 'general', label: 'Disposiciones generales' },
				{ id: 'contact', label: 'Contacto' },
				{ id: 'changelog', label: 'Registro de cambios' },
			]
		: [
				{ id: 'acceptance', label: 'Acceptance of Terms' },
				{ id: 'eligibility', label: 'Eligibility' },
				{ id: 'description', label: 'Description of Service' },
				{ id: 'accounts', label: 'User Accounts & Authentication' },
				{ id: 'acceptable-use', label: 'Acceptable Use' },
				{ id: 'intellectual-property', label: 'User Content & Intellectual Property' },
				{ id: 'api-access', label: 'API Access' },
				{ id: 'availability', label: 'Service Availability & Modifications' },
				{ id: 'warranties', label: 'Disclaimer of Warranties' },
				{ id: 'liability', label: 'Limitation of Liability' },
				{ id: 'indemnification', label: 'Indemnification' },
				{ id: 'termination', label: 'Termination' },
				{ id: 'privacy', label: 'Privacy' },
				{ id: 'governing-law', label: 'Governing Law' },
				{ id: 'disputes', label: 'Dispute Resolution' },
				{ id: 'changes', label: 'Changes to Terms' },
				{ id: 'general', label: 'General Provisions' },
				{ id: 'contact', label: 'Contact' },
				{ id: 'changelog', label: 'Changelog' },
			];

	const versions = [{ version: '1.0', date: effectiveDate, current: true }];

	const changelog = [
		{
			version: '1.0',
			date: effectiveDate,
			changes: [isEs ? 'Términos del servicio iniciales' : 'Initial terms of service'],
		},
	];
</script>

<LegalPage {title} {toc} {versions} {changelog}>
	{#if isEs}
		<section>
			<h2 id="acceptance">1. Aceptación de los términos</h2>
			<p>
				Al acceder o utilizar SpaceBot («el Servicio»), operado por Starspace Group
				(«Starspace», «nosotros» o «nuestro»), aceptas quedar vinculado por estos Términos
				del servicio («Términos»). Si no estás de acuerdo con estos Términos, no puedes usar
				el Servicio.
			</p>
			<p>
				Estos Términos incorporan por referencia nuestra
				<a href="/privacy">Política de privacidad</a>, que describe cómo recopilamos, usamos
				y protegemos tu información.
			</p>
		</section>

		<section>
			<h2 id="eligibility">2. Elegibilidad</h2>
			<p>
				Debes cumplir los requisitos de edad mínima establecidos por los
				<a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer"
					>Términos de servicio</a
				>
				de Discord para usar SpaceBot. Por lo general, esto significa que debes tener al menos
				13 años, o la edad mínima de consentimiento digital de tu país si es superior (p. ej.,
				16 en algunos estados miembros del EEE, 14 en Corea del Sur). Si eres menor de la edad
				mínima aplicable, no puedes usar el Servicio.
			</p>
			<p>
				Al usar el Servicio, declaras y garantizas que cumples estos requisitos de
				elegibilidad y que tienes la capacidad legal para aceptar estos Términos.
			</p>
		</section>

		<section>
			<h2 id="description">3. Descripción del servicio</h2>
			<p>
				SpaceBot es una plataforma de bots para Discord que permite a los administradores de
				servidor crear comandos de barra personalizados, construir automatizaciones basadas
				en eventos, ver analíticas del servidor y supervisar la actividad de Discord a
				través de un panel de administración web. El Servicio funciona como una aplicación
				de Discord y requiere una cuenta de Discord para usarlo.
			</p>
		</section>

		<section>
			<h2 id="accounts">4. Cuentas de usuario y autenticación</h2>
			<p>
				Accedes a SpaceBot autenticándote mediante Discord OAuth2. Eres responsable de
				mantener la seguridad de tu cuenta de Discord y eres plenamente responsable de todas
				las actividades que ocurran a través de tu uso del Servicio. Debes notificarnos con
				prontitud si tienes conocimiento de cualquier uso no autorizado de tu cuenta.
			</p>
			<p>
				No somos responsables de ninguna pérdida o daño derivado de tu incapacidad para
				proteger tu cuenta de Discord.
			</p>
		</section>

		<section>
			<h2 id="acceptable-use">5. Uso aceptable</h2>
			<p>Aceptas que no harás, ni permitirás que otros hagan, lo siguiente:</p>
			<ul>
				<li>
					Usar el Servicio de cualquier forma que infrinja cualquier ley o normativa
					local, estatal, nacional o internacional aplicable
				</li>
				<li>
					Usar el Servicio infringiendo los
					<a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer"
						>Términos de servicio de Discord</a
					>, las
					<a
						href="https://discord.com/guidelines"
						target="_blank"
						rel="noopener noreferrer">Directrices de la comunidad</a
					>
					o la
					<a
						href="https://discord.com/developers/docs/policies-and-agreements/developer-policy"
						target="_blank"
						rel="noopener noreferrer">Política para desarrolladores</a
					>
				</li>
				<li>
					Intentar obtener acceso no autorizado al Servicio, a las cuentas de otros
					usuarios o a cualquier sistema o red relacionados
				</li>
				<li>
					Usar el Servicio para enviar spam, mensajes no solicitados o participar en
					cualquier forma de acoso
				</li>
				<li>
					Usar el Servicio para distribuir malware, contenido de phishing u otro material
					malicioso
				</li>
				<li>
					Interferir o interrumpir la integridad, el rendimiento o la disponibilidad del
					Servicio
				</li>
				<li>
					Aplicar ingeniería inversa, descompilar, desensamblar o intentar derivar el
					código fuente del Servicio, salvo cuando lo permita la ley aplicable
				</li>
				<li>
					Usar el Servicio para recopilar, almacenar o procesar datos personales de otros
					usuarios infringiendo las leyes de privacidad aplicables
				</li>
				<li>
					Usar el Servicio de cualquier manera que pueda exponernos a nosotros, a Discord
					o a otros usuarios a responsabilidad o daño
				</li>
				<li>
					Crear automatizaciones o comandos que infrinjan los derechos de propiedad
					intelectual de terceros
				</li>
			</ul>
			<p>
				Nos reservamos el derecho de investigar y tomar las medidas oportunas, incluida la
				suspensión o rescisión del acceso, contra cualquiera que infrinja estas
				disposiciones.
			</p>
		</section>

		<section>
			<h2 id="intellectual-property">6. Contenido del usuario y propiedad intelectual</h2>
			<h3>6.1 Tu contenido</h3>
			<p>
				Conservas la propiedad de cualquier contenido que crees a través del Servicio,
				incluidos comandos personalizados, automatizaciones y datos de configuración
				(«Contenido del usuario»). No reclamamos la propiedad de tu Contenido del usuario.
			</p>
			<p>
				Al usar el Servicio, nos concedes una licencia limitada, no exclusiva, libre de
				regalías y mundial para almacenar, procesar, mostrar y transmitir tu Contenido del
				usuario únicamente en la medida necesaria para prestar y operar el Servicio. Esta
				licencia finaliza cuando eliminas tu Contenido del usuario o retiras SpaceBot de tu
				servidor.
			</p>

			<h3>6.2 Nuestra propiedad intelectual</h3>
			<p>
				El Servicio, incluidos su código original, diseño, funciones y documentación, es
				propiedad de Starspace Group y se licencia conforme a los términos especificados en
				nuestro
				<a
					href="https://github.com/starspacegroup/spacebot"
					target="_blank"
					rel="noopener noreferrer">repositorio de GitHub</a
				>. Estos Términos no te conceden ningún derecho a usar nuestras marcas comerciales,
				logotipos o identidad de marca sin consentimiento previo por escrito.
			</p>

			<h3>6.3 Responsabilidad por el Contenido del usuario</h3>
			<p>
				Eres el único responsable de tu Contenido del usuario y de las consecuencias de
				usarlo a través del Servicio. Declaras y garantizas que tu Contenido del usuario no
				infringe ninguna ley, normativa o derecho de terceros aplicables. No respaldamos ni
				asumimos responsabilidad por ningún Contenido del usuario.
			</p>
		</section>

		<section>
			<h2 id="api-access">7. Acceso a la API</h2>
			<p>
				El Servicio puede proporcionar acceso a la API para la interacción programática. Las
				claves de API se emiten por servidor y son responsabilidad del administrador del
				servidor. Aceptas no compartir las claves de API con terceros no autorizados y
				revocar de inmediato las claves comprometidas. Nos reservamos el derecho de limitar
				la tasa, restringir o revocar el acceso a la API en cualquier momento.
			</p>
		</section>

		<section>
			<h2 id="availability">8. Disponibilidad del servicio y modificaciones</h2>
			<p>
				Nos esforzamos por mantener SpaceBot disponible y funcionando de forma fiable, pero
				no garantizamos un acceso ininterrumpido, sin errores ni seguro. El Servicio puede
				estar temporalmente no disponible debido a mantenimiento, actualizaciones, cambios
				en la API de Discord o circunstancias fuera de nuestro control.
			</p>
			<p>
				Nos reservamos el derecho de modificar, suspender o discontinuar cualquier parte del
				Servicio en cualquier momento, con o sin previo aviso. Haremos esfuerzos razonables
				para notificar a los usuarios los cambios significativos.
			</p>
		</section>

		<section>
			<h2 id="warranties">9. Renuncia de garantías</h2>
			<p>
				EL SERVICIO SE PROPORCIONA «TAL CUAL» Y «SEGÚN DISPONIBILIDAD», SIN GARANTÍAS DE
				NINGÚN TIPO, YA SEAN EXPRESAS O IMPLÍCITAS, INCLUIDAS, ENTRE OTRAS, LAS GARANTÍAS
				IMPLÍCITAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN DETERMINADO, TITULARIDAD Y NO
				INFRACCIÓN. NO GARANTIZAMOS QUE EL SERVICIO SEA ININTERRUMPIDO, SEGURO O LIBRE DE
				ERRORES, NI QUE LOS DEFECTOS SEAN CORREGIDOS.
			</p>
			<p>
				ALGUNAS JURISDICCIONES NO PERMITEN LA EXCLUSIÓN DE DETERMINADAS GARANTÍAS. EN DICHAS
				JURISDICCIONES, LAS EXCLUSIONES ANTERIORES SE APLICARÁN EN LA MÁXIMA MEDIDA
				PERMITIDA POR LA LEY APLICABLE.
			</p>
		</section>

		<section>
			<h2 id="liability">10. Limitación de responsabilidad</h2>
			<p>
				EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY APLICABLE, EN NINGÚN CASO STARSPACE GROUP,
				SUS MIEMBROS, COLABORADORES O AFILIADOS SERÁN RESPONSABLES DE NINGÚN DAÑO INDIRECTO,
				INCIDENTAL, ESPECIAL, CONSECUENTE O PUNITIVO, NI DE NINGUNA PÉRDIDA DE BENEFICIOS,
				DATOS, USO, FONDO DE COMERCIO U OTRAS PÉRDIDAS INTANGIBLES, DERIVADOS DE:
			</p>
			<ul class="uppercase-list">
				<li>Tu acceso, uso o incapacidad de usar el Servicio</li>
				<li>Cualquier conducta o contenido de terceros en el Servicio o a través de él</li>
				<li>
					Cualquier Contenido del usuario o automatización creados a través del Servicio
				</li>
				<li>El acceso no autorizado o la alteración de tus datos o transmisiones</li>
				<li>Cualquier interrupción, suspensión o rescisión del Servicio</li>
			</ul>
			<p>
				ALGUNAS JURISDICCIONES NO PERMITEN LA LIMITACIÓN O EXCLUSIÓN DE RESPONSABILIDAD POR
				DAÑOS INCIDENTALES O CONSECUENTES. EN DICHAS JURISDICCIONES, NUESTRA RESPONSABILIDAD
				SE LIMITARÁ EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY.
			</p>
		</section>

		<section>
			<h2 id="indemnification">11. Indemnización</h2>
			<p>
				Aceptas indemnizar, defender y eximir de responsabilidad a Starspace Group y a sus
				miembros, colaboradores y afiliados frente a cualquier reclamación, responsabilidad,
				daño, pérdida y gasto (incluidos los honorarios legales razonables) que surjan de o
				estén relacionados de cualquier modo con: (a) tu uso del Servicio; (b) tu
				incumplimiento de estos Términos; (c) tu infracción de los derechos de terceros,
				incluidos los términos de Discord; o (d) tu Contenido del usuario.
			</p>
			<p>
				Esta obligación de indemnización se aplicará en la máxima medida permitida por la
				ley aplicable. En las jurisdicciones donde las cláusulas de indemnización estén
				restringidas, esta sección se aplica en la máxima medida permitida.
			</p>
		</section>

		<section>
			<h2 id="termination">12. Rescisión</h2>
			<p>
				Nos reservamos el derecho de suspender o rescindir tu acceso al Servicio en
				cualquier momento, con o sin causa, y con o sin previo aviso. Los motivos de
				rescisión incluyen, entre otros, el incumplimiento de estos Términos, de las
				políticas de Discord o de la ley aplicable.
			</p>
			<p>
				Puedes dejar de usar el Servicio en cualquier momento retirando SpaceBot de tu
				servidor de Discord y revocando el acceso OAuth2 desde tu
				<a
					href="https://discord.com/settings/authorized-apps"
					target="_blank"
					rel="noopener noreferrer"
					>configuración de aplicaciones autorizadas de Discord</a
				>.
			</p>
			<p>
				Tras la rescisión, tu derecho a usar el Servicio cesa de inmediato. Las secciones 6
				(Propiedad intelectual), 9 (Renuncia), 10 (Limitación de responsabilidad), 11
				(Indemnización), 14 (Ley aplicable) y 15 (Resolución de disputas) sobrevivirán a la
				rescisión.
			</p>
		</section>

		<section>
			<h2 id="privacy">13. Privacidad</h2>
			<p>
				Tu uso del Servicio también se rige por nuestra
				<a href="/privacy">Política de privacidad</a>, que describe cómo recopilamos,
				usamos, almacenamos y protegemos tus datos. Al usar el Servicio, aceptas las
				prácticas descritas en la Política de privacidad.
			</p>
		</section>

		<section>
			<h2 id="governing-law">14. Ley aplicable</h2>
			<p>
				Estos Términos se regirán e interpretarán de acuerdo con las leyes de los Estados
				Unidos, sin tener en cuenta los principios de conflicto de leyes.
			</p>
			<p>
				Nada en estos Términos afectará a los derechos obligatorios de protección del
				consumidor que puedas tener en virtud de las leyes de tu jurisdicción. Si eres
				consumidor en la Unión Europea, el Reino Unido o cualquier otra jurisdicción con
				leyes obligatorias de protección del consumidor, dichas leyes se aplicarán en la
				medida requerida.
			</p>
		</section>

		<section>
			<h2 id="disputes">15. Resolución de disputas</h2>
			<p>
				En caso de cualquier disputa que surja de o esté relacionada con estos Términos o el
				Servicio, las partes acuerdan intentar primero resolver la disputa de forma informal
				contactando con nosotros. Si la disputa no puede resolverse de forma informal en un
				plazo de 30 días, cualquiera de las partes podrá recurrir a los recursos disponibles
				conforme a la ley aplicable.
			</p>
			<p>
				Si eres consumidor en la Unión Europea, también puedes tener derecho a presentar una
				disputa ante la
				<a
					href="https://ec.europa.eu/consumers/odr"
					target="_blank"
					rel="noopener noreferrer"
					>plataforma de Resolución de Litigios en Línea de la UE</a
				>.
			</p>
		</section>

		<section>
			<h2 id="changes">16. Cambios en los términos</h2>
			<p>
				Podemos actualizar estos Términos de vez en cuando. Notificaremos a los usuarios los
				cambios importantes actualizando la fecha de «Última actualización» en la parte
				superior de esta página, y haremos esfuerzos razonables para avisar de los cambios
				significativos a través de nuestro repositorio de GitHub o del servidor de soporte
				de Discord. Tu uso continuado del Servicio después de que los cambios entren en
				vigor constituye tu aceptación de los Términos revisados.
			</p>
			<p>
				Si no estás de acuerdo con los Términos revisados, debes dejar de usar el Servicio.
			</p>
		</section>

		<section>
			<h2 id="general">17. Disposiciones generales</h2>
			<h3>17.1 Acuerdo completo</h3>
			<p>
				Estos Términos, junto con la Política de privacidad, constituyen el acuerdo completo
				entre tú y Starspace Group respecto al Servicio y sustituyen todos los acuerdos y
				entendimientos previos.
			</p>

			<h3>17.2 Divisibilidad</h3>
			<p>
				Si un tribunal competente considera que alguna disposición de estos Términos es
				inválida, ilegal o inaplicable, dicha disposición se modificará en la medida mínima
				necesaria para hacerla aplicable o, si la modificación no es posible, se separará de
				estos Términos. Las disposiciones restantes seguirán en pleno vigor y efecto.
			</p>

			<h3>17.3 Renuncia</h3>
			<p>
				Nuestra falta de aplicación de cualquier derecho o disposición de estos Términos no
				constituirá una renuncia a ese derecho o disposición. Toda renuncia debe hacerse por
				escrito y estar firmada por nosotros.
			</p>

			<h3>17.4 Cesión</h3>
			<p>
				No puedes ceder ni transferir estos Términos ni tus derechos en virtud de ellos sin
				nuestro consentimiento previo por escrito. Nosotros podemos ceder estos Términos sin
				restricción.
			</p>
		</section>

		<section>
			<h2 id="contact">18. Contacto</h2>
			<p>Si tienes alguna pregunta sobre estos Términos, contáctanos a través de:</p>
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
		</section>
	{:else}
		<section>
			<h2 id="acceptance">1. Acceptance of Terms</h2>
			<p>
				By accessing or using SpaceBot ("the Service"), operated by Starspace Group
				("Starspace", "we", "us", or "our"), you agree to be bound by these Terms of Service
				("Terms"). If you do not agree to these Terms, you may not use the Service.
			</p>
			<p>
				These Terms incorporate by reference our
				<a href="/privacy">Privacy Policy</a>, which describes how we collect, use, and
				protect your information.
			</p>
		</section>

		<section>
			<h2 id="eligibility">2. Eligibility</h2>
			<p>
				You must meet the minimum age requirements set by Discord's
				<a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer"
					>Terms of Service</a
				>
				to use SpaceBot. Generally, this means you must be at least 13 years old, or the minimum
				digital consent age in your country if higher (e.g., 16 in some EEA member states, 14
				in South Korea). If you are under the applicable minimum age, you may not use the Service.
			</p>
			<p>
				By using the Service, you represent and warrant that you meet these eligibility
				requirements and that you have the legal capacity to enter into these Terms.
			</p>
		</section>

		<section>
			<h2 id="description">3. Description of Service</h2>
			<p>
				SpaceBot is a Discord bot platform that allows server administrators to create
				custom slash commands, build event-driven automations, view server analytics, and
				monitor Discord activity through a web-based admin dashboard. The Service operates
				as a Discord application and requires a Discord account to use.
			</p>
		</section>

		<section>
			<h2 id="accounts">4. User Accounts &amp; Authentication</h2>
			<p>
				You access SpaceBot by authenticating through Discord OAuth2. You are responsible
				for maintaining the security of your Discord account and are fully responsible for
				all activities that occur through your use of the Service. You must promptly notify
				us if you become aware of any unauthorized use of your account.
			</p>
			<p>
				We are not responsible for any loss or damage arising from your failure to secure
				your Discord account.
			</p>
		</section>

		<section>
			<h2 id="acceptable-use">5. Acceptable Use</h2>
			<p>You agree that you will not, and will not permit others to:</p>
			<ul>
				<li>
					Use the Service in any way that violates any applicable local, state, national,
					or international law or regulation
				</li>
				<li>
					Use the Service in violation of
					<a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer"
						>Discord's Terms of Service</a
					>,
					<a
						href="https://discord.com/guidelines"
						target="_blank"
						rel="noopener noreferrer">Community Guidelines</a
					>, or
					<a
						href="https://discord.com/developers/docs/policies-and-agreements/developer-policy"
						target="_blank"
						rel="noopener noreferrer">Developer Policy</a
					>
				</li>
				<li>
					Attempt to gain unauthorized access to the Service, other users' accounts, or
					any related systems or networks
				</li>
				<li>
					Use the Service to send spam, unsolicited messages, or engage in any form of
					harassment
				</li>
				<li>
					Use the Service to distribute malware, phishing content, or other malicious
					material
				</li>
				<li>
					Interfere with or disrupt the integrity, performance, or availability of the
					Service
				</li>
				<li>
					Reverse-engineer, decompile, disassemble, or attempt to derive the source code
					of the Service, except where permitted by applicable law
				</li>
				<li>
					Use the Service to collect, store, or process personal data of other users in
					violation of applicable privacy laws
				</li>
				<li>
					Use the Service in any manner that could expose us, Discord, or other users to
					liability or harm
				</li>
				<li>
					Create automations or commands that violate any third party's intellectual
					property rights
				</li>
			</ul>
			<p>
				We reserve the right to investigate and take appropriate action, including
				suspension or termination of access, against anyone who violates these provisions.
			</p>
		</section>

		<section>
			<h2 id="intellectual-property">6. User Content &amp; Intellectual Property</h2>
			<h3>6.1 Your Content</h3>
			<p>
				You retain ownership of any content you create through the Service, including custom
				commands, automations, and configuration data ("User Content"). We do not claim
				ownership of your User Content.
			</p>
			<p>
				By using the Service, you grant us a limited, non-exclusive, royalty-free, worldwide
				license to store, process, display, and transmit your User Content solely as
				necessary to provide and operate the Service. This license terminates when you
				delete your User Content or remove SpaceBot from your server.
			</p>

			<h3>6.2 Our Intellectual Property</h3>
			<p>
				The Service, including its original code, design, features, and documentation, is
				owned by Starspace Group and is licensed under the terms specified in our
				<a
					href="https://github.com/starspacegroup/spacebot"
					target="_blank"
					rel="noopener noreferrer">GitHub repository</a
				>. These Terms do not grant you any rights to use our trademarks, logos, or branding
				without prior written consent.
			</p>

			<h3>6.3 Responsibility for User Content</h3>
			<p>
				You are solely responsible for your User Content and the consequences of using it
				through the Service. You represent and warrant that your User Content does not
				violate any applicable law, regulation, or third-party rights. We do not endorse or
				assume liability for any User Content.
			</p>
		</section>

		<section>
			<h2 id="api-access">7. API Access</h2>
			<p>
				The Service may provide API access for programmatic interaction. API keys are issued
				per-server and are the responsibility of the server administrator. You agree not to
				share API keys with unauthorized third parties and to revoke compromised keys
				immediately. We reserve the right to rate-limit, restrict, or revoke API access at
				any time.
			</p>
		</section>

		<section>
			<h2 id="availability">8. Service Availability &amp; Modifications</h2>
			<p>
				We strive to keep SpaceBot available and functioning reliably, but we do not
				guarantee uninterrupted, error-free, or secure access. The Service may be
				temporarily unavailable due to maintenance, updates, Discord API changes, or
				circumstances beyond our control.
			</p>
			<p>
				We reserve the right to modify, suspend, or discontinue any part of the Service at
				any time, with or without notice. We will make reasonable efforts to notify users of
				significant changes.
			</p>
		</section>

		<section>
			<h2 id="warranties">9. Disclaimer of Warranties</h2>
			<p>
				THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
				EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
				MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE
				DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR
				THAT DEFECTS WILL BE CORRECTED.
			</p>
			<p>
				SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF CERTAIN WARRANTIES. IN SUCH
				JURISDICTIONS, THE ABOVE EXCLUSIONS SHALL APPLY TO THE FULLEST EXTENT PERMITTED BY
				APPLICABLE LAW.
			</p>
		</section>

		<section>
			<h2 id="liability">10. Limitation of Liability</h2>
			<p>
				TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL STARSPACE
				GROUP, ITS MEMBERS, CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT,
				INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
				DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:
			</p>
			<ul class="uppercase-list">
				<li>Your access to, use of, or inability to use the Service</li>
				<li>Any conduct or content of any third party on or through the Service</li>
				<li>Any User Content or automations created through the Service</li>
				<li>Unauthorized access to or alteration of your data or transmissions</li>
				<li>Any interruption, suspension, or termination of the Service</li>
			</ul>
			<p>
				SOME JURISDICTIONS DO NOT ALLOW THE LIMITATION OR EXCLUSION OF LIABILITY FOR
				INCIDENTAL OR CONSEQUENTIAL DAMAGES. IN SUCH JURISDICTIONS, OUR LIABILITY SHALL BE
				LIMITED TO THE FULLEST EXTENT PERMITTED BY LAW.
			</p>
		</section>

		<section>
			<h2 id="indemnification">11. Indemnification</h2>
			<p>
				You agree to indemnify, defend, and hold harmless Starspace Group and its members,
				contributors, and affiliates from and against any claims, liabilities, damages,
				losses, and expenses (including reasonable legal fees) arising out of or in any way
				connected with: (a) your use of the Service; (b) your violation of these Terms; (c)
				your violation of any third-party rights, including Discord's terms; or (d) your
				User Content.
			</p>
			<p>
				This indemnification obligation shall apply to the fullest extent permitted by
				applicable law. In jurisdictions where indemnification clauses are restricted, this
				section applies to the maximum extent allowed.
			</p>
		</section>

		<section>
			<h2 id="termination">12. Termination</h2>
			<p>
				We reserve the right to suspend or terminate your access to the Service at any time,
				with or without cause, and with or without notice. Grounds for termination include,
				but are not limited to, violation of these Terms, Discord's policies, or applicable
				law.
			</p>
			<p>
				You may stop using the Service at any time by removing SpaceBot from your Discord
				server and revoking OAuth2 access through your
				<a
					href="https://discord.com/settings/authorized-apps"
					target="_blank"
					rel="noopener noreferrer">Discord Authorized Apps settings</a
				>.
			</p>
			<p>
				Upon termination, your right to use the Service ceases immediately. Sections 6
				(Intellectual Property), 9 (Disclaimer), 10 (Limitation of Liability), 11
				(Indemnification), 14 (Governing Law), and 15 (Dispute Resolution) shall survive
				termination.
			</p>
		</section>

		<section>
			<h2 id="privacy">13. Privacy</h2>
			<p>
				Your use of the Service is also governed by our <a href="/privacy">Privacy Policy</a
				>, which describes how we collect, use, store, and protect your data. By using the
				Service, you consent to the practices described in the Privacy Policy.
			</p>
		</section>

		<section>
			<h2 id="governing-law">14. Governing Law</h2>
			<p>
				These Terms shall be governed by and construed in accordance with the laws of the
				United States, without regard to conflict of law principles.
			</p>
			<p>
				Nothing in these Terms shall affect any mandatory consumer protection rights you may
				have under the laws of your jurisdiction. If you are a consumer in the European
				Union, United Kingdom, or any other jurisdiction with mandatory consumer protection
				laws, those laws shall apply to the extent required.
			</p>
		</section>

		<section>
			<h2 id="disputes">15. Dispute Resolution</h2>
			<p>
				In the event of any dispute arising out of or relating to these Terms or the
				Service, the parties agree to first attempt to resolve the dispute informally by
				contacting us. If the dispute cannot be resolved informally within 30 days, either
				party may pursue the remedies available under applicable law.
			</p>
			<p>
				If you are a consumer in the European Union, you may also be entitled to submit a
				dispute to the
				<a
					href="https://ec.europa.eu/consumers/odr"
					target="_blank"
					rel="noopener noreferrer">EU Online Dispute Resolution platform</a
				>.
			</p>
		</section>

		<section>
			<h2 id="changes">16. Changes to Terms</h2>
			<p>
				We may update these Terms from time to time. We will notify users of material
				changes by updating the "Last updated" date at the top of this page, and we will
				make reasonable efforts to provide notice of significant changes through our GitHub
				repository or Discord support server. Your continued use of the Service after
				changes become effective constitutes your acceptance of the revised Terms.
			</p>
			<p>
				If you do not agree with the revised Terms, you must discontinue your use of the
				Service.
			</p>
		</section>

		<section>
			<h2 id="general">17. General Provisions</h2>
			<h3>17.1 Entire Agreement</h3>
			<p>
				These Terms, together with the Privacy Policy, constitute the entire agreement
				between you and Starspace Group regarding the Service and supersede all prior
				agreements and understandings.
			</p>

			<h3>17.2 Severability</h3>
			<p>
				If any provision of these Terms is found to be invalid, illegal, or unenforceable by
				a court of competent jurisdiction, that provision shall be modified to the minimum
				extent necessary to make it enforceable, or if modification is not possible, severed
				from these Terms. The remaining provisions shall continue in full force and effect.
			</p>

			<h3>17.3 Waiver</h3>
			<p>
				Our failure to enforce any right or provision of these Terms shall not constitute a
				waiver of that right or provision. Any waiver must be in writing and signed by us.
			</p>

			<h3>17.4 Assignment</h3>
			<p>
				You may not assign or transfer these Terms or your rights under them without our
				prior written consent. We may assign these Terms without restriction.
			</p>
		</section>

		<section>
			<h2 id="contact">18. Contact</h2>
			<p>If you have any questions about these Terms, please contact us via:</p>
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
		</section>
	{/if}
</LegalPage>
