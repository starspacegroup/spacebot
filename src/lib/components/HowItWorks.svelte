<script lang="ts">
	/**
	 * "How it works" on the home page: two four-step flows, each step a small animated SVG scene.
	 *
	 * - The scenes are hand-drawn SVG moved with CSS keyframes. There is no animation library.
	 * - Each scene loops about every 6 seconds and only runs while its flow is on screen.
	 * - With "reduce motion" on, nothing moves: every scene shows a still that makes sense.
	 * - Each scene's base style is its still. The keyframes play the whole story from the start.
	 * - Without JavaScript the page shows the stills, fully visible.
	 */
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();

	// Discord's mark (71×55 viewBox), the same one the old mock used.
	const DISCORD =
		'M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.4 37.4 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.5 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0 0 17.7 9 .2.2 0 0 0 .3-.1 42.1 42.1 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.9a.2.2 0 0 1 .2 0c11.6 5.3 24.2 5.3 35.7 0a.2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4c-1.8 1-3.6 1.9-5.6 2.6a.2.2 0 0 0-.1.3 47.3 47.3 0 0 0 3.7 5.9.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.7-9 .2.2 0 0 0 .1-.2c1.4-15-2.3-28.4-9.8-40.1a.2.2 0 0 0-.1-.1ZM23.7 37.3c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.8 7.1-6.3 7.1Zm23.3 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.7 7.1-6.3 7.1Z';

	const BARS = [
		{ x: 26, h: 38 },
		{ x: 52, h: 62 },
		{ x: 78, h: 44 },
		{ x: 104, h: 80 },
		{ x: 130, h: 56 },
		{ x: 156, h: 92 },
	];

	/**
	 * Marks a flow as "on screen" (so its animations run) and "seen" (so its steps slide in once).
	 * Without IntersectionObserver the flow simply plays.
	 */
	function inView(node: HTMLElement) {
		node.classList.add('armed');
		if (typeof IntersectionObserver === 'undefined') {
			node.classList.add('playing', 'seen');
			return;
		}
		const io = new IntersectionObserver(
			([entry]) => {
				node.classList.toggle('playing', entry.isIntersecting);
				if (entry.isIntersecting) node.classList.add('seen');
			},
			{ threshold: 0.2 }
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}
</script>

<!-- Shared definitions for the scenes -->
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
	<defs>
		<clipPath id="hiw-round" clipPathUnits="objectBoundingBox">
			<circle cx=".5" cy=".5" r=".5" />
		</clipPath>
		<radialGradient id="hiw-halo" cx=".5" cy=".5" r=".5">
			<stop offset="0" class="halo-a" />
			<stop offset="1" class="halo-b" />
		</radialGradient>
		<linearGradient id="hiw-brand" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" class="stop-a" />
			<stop offset="1" class="stop-b" />
		</linearGradient>
	</defs>
</svg>

{#snippet arrow()}
	<div class="step-connector" aria-hidden="true">
		<svg width="44" height="24" viewBox="0 0 44 24" fill="none">
			<path class="flow-arrow-line" d="M2 12h34" />
			<path class="flow-arrow-head" d="M31 6l7 6-7 6" />
		</svg>
	</div>
{/snippet}

<section class="how">
	<h2>{tr('home.how.heading')}</h2>

	<!-- Flow 1: from login to a working bot -->
	<div class="flow" use:inView>
		<ol class="steps">
			<li class="step" style="--i: 0">
				<div class="step-card">
					<svg class="scene s1" viewBox="0 0 220 220" aria-hidden="true">
						<circle class="halo" cx="110" cy="112" r="92" />
						<g class="s1-btn">
							<rect class="blurple" x="34" y="90" width="152" height="44" rx="13" />
							<g transform="translate(72 104) scale(.42)"
								><path class="glyph" d={DISCORD} /></g
							>
							<text class="btn-text" x="106" y="117">{tr('home.how.login')}</text>
						</g>
						<g class="s1-chip">
							<circle class="avatar-bg" cx="110" cy="100" r="30" />
							<circle class="avatar-fg" cx="110" cy="92" r="10" />
							<path class="avatar-fg" d="M90 120a20 15 0 0 1 40 0z" />
							<circle class="badge-ok" cx="136" cy="124" r="11" />
							<path class="tick" d="M130 124l4 4 8-9" />
							<rect class="pill" x="72" y="146" width="76" height="10" rx="5" />
						</g>
						<g class="s1-ring"><circle cx="126" cy="112" r="8" /></g>
						<g class="s1-cursor">
							<path d="M0 0v18l5-4.5 3.6 8.2 3.4-1.5-3.6-8H16z" class="cursor" />
						</g>
					</svg>
				</div>
				<span class="step-label"
					><span class="step-num" aria-hidden="true">1</span>{tr('home.how.step1')}</span
				>
			</li>

			{@render arrow()}

			<li class="step" style="--i: 1">
				<div class="step-card">
					<svg class="scene s2" viewBox="0 0 220 220" aria-hidden="true">
						<rect class="rail" x="74" y="18" width="72" height="184" rx="22" />
						<circle class="srv" cx="110" cy="52" r="17" />
						<circle class="srv" cx="110" cy="94" r="17" />
						<path class="divider" d="M96 124h28" />
						<circle class="slot" cx="110" cy="158" r="20" />
						<path class="slot-plus" d="M110 150v16M102 158h16" />
						<g class="s2-pulse"><circle cx="110" cy="158" r="20" /></g>
						<g class="s2-bot">
							<image
								href="/logo.webp"
								x="88"
								y="136"
								width="44"
								height="44"
								clip-path="url(#hiw-round)"
							/>
							<circle class="bot-ring" cx="110" cy="158" r="23" />
						</g>
						<g class="s2-spark s2-spark-a"
							><path d="M52 118l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /></g
						>
						<g class="s2-spark s2-spark-b"
							><path
								d="M170 138l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z"
							/></g
						>
						<g class="s2-spark s2-spark-c"
							><path d="M160 90l2 4.6 4.6 2-4.6 2-2 4.6-2-4.6-4.6-2 4.6-2z" /></g
						>
					</svg>
				</div>
				<span class="step-label"
					><span class="step-num" aria-hidden="true">2</span>{tr('home.how.step2')}</span
				>
			</li>

			{@render arrow()}

			<li class="step" style="--i: 2">
				<div class="step-card">
					<svg class="scene s3" viewBox="0 0 220 220" aria-hidden="true">
						<rect class="win" x="10" y="12" width="200" height="196" rx="14" />
						<rect class="win-bar" x="10" y="12" width="200" height="26" rx="14" />
						<rect class="win-bar" x="10" y="26" width="200" height="12" />
						<text class="chan" x="22" y="30"># general</text>

						<g class="s3-reply">
							<image
								href="/logo.webp"
								x="20"
								y="52"
								width="30"
								height="30"
								clip-path="url(#hiw-round)"
							/>
							<text class="who" x="58" y="62">SpaceBot</text>
							<text class="said" x="58" y="79">Hello, world!</text>
						</g>
						<g class="s3-dots">
							<circle cx="62" cy="76" r="3" />
							<circle cx="73" cy="76" r="3" />
							<circle cx="84" cy="76" r="3" />
						</g>

						<g class="s3-menu">
							<rect class="menu" x="20" y="118" width="148" height="40" rx="10" />
							<text class="menu-cmd" x="32" y="135"
								><tspan class="slash">/</tspan>hello</text
							>
							<rect class="menu-line" x="32" y="143" width="92" height="6" rx="3" />
						</g>

						<rect class="input" x="16" y="168" width="188" height="32" rx="11" />
						<text class="typed" x="30" y="189"
							><tspan class="slash">/</tspan>hello world</text
						>
						<rect class="s3-cover" x="29" y="172" width="90" height="24" />
						<rect class="s3-caret" x="30" y="175" width="2" height="18" rx="1" />
					</svg>
				</div>
				<span class="step-label"
					><span class="step-num" aria-hidden="true">3</span>{tr('home.how.step3')}</span
				>
			</li>

			{@render arrow()}

			<li class="step" style="--i: 3">
				<div class="step-card">
					<svg class="scene s4" viewBox="0 0 220 220" aria-hidden="true">
						<rect class="win" x="10" y="12" width="200" height="196" rx="14" />
						<image
							href="/logo.webp"
							x="22"
							y="22"
							width="18"
							height="18"
							clip-path="url(#hiw-round)"
						/>
						<text class="chan" x="46" y="35">{tr('home.how.dashboard')}</text>
						<g class="s4-live">
							<circle cx="186" cy="30" r="9" class="live-ring" />
							<circle cx="186" cy="30" r="4" class="live-dot" />
						</g>
						<path class="grid-line" d="M24 76h172M24 110h172M24 144h172M24 178h172" />
						{#each BARS as b, i (i)}
							<rect
								class="bar s4-bar"
								style="--d: {i * 0.12}s"
								x={b.x + 6}
								y={186 - b.h}
								width="18"
								height={b.h}
								rx="4"
							/>
						{/each}
						<path
							class="s4-line"
							d="M35 150L61 128 87 140 113 98 139 122 165 84 191 70"
							pathLength="100"
						/>
						<circle class="s4-dot" cx="191" cy="70" r="5" />
					</svg>
				</div>
				<span class="step-label"
					><span class="step-num" aria-hidden="true">4</span>{tr('home.how.step4')}</span
				>
			</li>
		</ol>
	</div>

	<!-- Flow 2: reaching your own machine -->
	<div class="how-subflow">
		<h3>{tr('home.how.runner.heading')}</h3>
		<p class="how-subtitle">{tr('home.how.runner.subtitle')}</p>

		<div class="flow" use:inView>
			<ol class="steps">
				<li class="step" style="--i: 0">
					<div class="step-card">
						<svg class="scene s5" viewBox="0 0 220 220" aria-hidden="true">
							<rect class="term" x="10" y="14" width="200" height="192" rx="14" />
							<circle class="td td-r" cx="28" cy="32" r="5" />
							<circle class="td td-y" cx="44" cy="32" r="5" />
							<circle class="td td-g" cx="60" cy="32" r="5" />
							<text class="cmd" x="24" y="72"
								><tspan class="prompt">$</tspan> bun run runner:start</text
							>
							<rect class="s5-cover" x="23" y="58" width="164" height="20" />
							<rect class="s5-caret" x="24" y="60" width="7" height="14" rx="1.5" />
							<g class="s5-ok">
								<path class="ok-tick" d="M24 102l5 5 9-11" />
								<text class="ok-text" x="46" y="106">runner online</text>
							</g>
							<g class="s5-bars">
								<rect class="skel" x="24" y="128" width="150" height="7" rx="3.5" />
								<rect class="skel" x="24" y="144" width="110" height="7" rx="3.5" />
								<rect class="skel" x="24" y="160" width="132" height="7" rx="3.5" />
							</g>
						</svg>
					</div>
					<span class="step-label"
						><span class="step-num" aria-hidden="true">1</span>{tr(
							'home.how.runner.step1'
						)}</span
					>
				</li>

				{@render arrow()}

				<li class="step" style="--i: 1">
					<div class="step-card">
						<svg class="scene s6" viewBox="0 0 220 220" aria-hidden="true">
							<rect class="win" x="10" y="12" width="200" height="196" rx="14" />
							<rect class="win-bar" x="10" y="12" width="200" height="26" rx="14" />
							<rect class="win-bar" x="10" y="26" width="200" height="12" />
							<text class="chan" x="22" y="30"># general</text>

							<g class="s6-embed">
								<image
									href="/logo.webp"
									x="20"
									y="52"
									width="30"
									height="30"
									clip-path="url(#hiw-round)"
								/>
								<text class="who" x="58" y="62">SpaceBot</text>
								<rect class="embed" x="58" y="68" width="134" height="46" rx="8" />
								<rect
									class="embed-edge"
									x="58"
									y="68"
									width="4"
									height="46"
									rx="2"
								/>
								<circle class="badge-ok" cx="80" cy="91" r="10" />
								<path class="tick" d="M75 91l4 4 7-8" />
								<rect class="skel" x="96" y="82" width="80" height="7" rx="3.5" />
								<rect class="skel" x="96" y="96" width="54" height="7" rx="3.5" />
							</g>

							<g class="s6-menu">
								<rect class="menu" x="20" y="124" width="160" height="34" rx="10" />
								<text class="menu-cmd" x="32" y="145"
									><tspan class="slash">/</tspan>runner connect</text
								>
							</g>

							<rect class="input" x="16" y="168" width="188" height="32" rx="11" />
							<text class="typed" x="30" y="189"
								><tspan class="slash">/</tspan>runner connect</text
							>
							<rect class="s6-cover" x="29" y="172" width="112" height="24" />
							<rect class="s6-caret" x="30" y="175" width="2" height="18" rx="1" />
						</svg>
					</div>
					<span class="step-label"
						><span class="step-num" aria-hidden="true">2</span>{tr(
							'home.how.runner.step2'
						)}</span
					>
				</li>

				{@render arrow()}

				<li class="step" style="--i: 2">
					<div class="step-card">
						<svg class="scene s7" viewBox="0 0 220 220" aria-hidden="true">
							<!-- your machine -->
							<g class="node">
								<rect class="laptop" x="14" y="76" width="54" height="38" rx="6" />
								<rect
									class="laptop-base"
									x="6"
									y="116"
									width="70"
									height="7"
									rx="3.5"
								/>
								<rect class="skel" x="22" y="86" width="30" height="5" rx="2.5" />
								<rect class="skel" x="22" y="96" width="38" height="5" rx="2.5" />
							</g>
							<!-- the bot -->
							<g class="node">
								<circle class="cloud" cx="186" cy="97" r="26" />
								<image
									href="/logo.webp"
									x="168"
									y="79"
									width="36"
									height="36"
									clip-path="url(#hiw-round)"
								/>
							</g>
							<!-- the tunnel -->
							<path class="pipe" d="M80 90h64M80 104h64" />
							<path class="s7-flow" d="M80 97h74" />
							<rect
								class="packet s7-p1"
								x="80"
								y="92"
								width="9"
								height="9"
								rx="2.5"
							/>
							<rect
								class="packet s7-p2"
								x="80"
								y="92"
								width="9"
								height="9"
								rx="2.5"
							/>
							<rect
								class="packet s7-p3"
								x="80"
								y="92"
								width="9"
								height="9"
								rx="2.5"
							/>
							<g class="chip">
								<rect x="38" y="150" width="144" height="34" rx="17" />
								<circle class="chip-pulse" cx="62" cy="167" r="7" />
								<circle class="chip-dot" cx="62" cy="167" r="5" />
								<text x="78" y="172">{tr('home.how.runner.tunnelActive')}</text>
							</g>
							<text class="host" x="41" y="140">localhost:3000</text>
						</svg>
					</div>
					<span class="step-label"
						><span class="step-num" aria-hidden="true">3</span>{tr(
							'home.how.runner.step3'
						)}</span
					>
				</li>

				{@render arrow()}

				<li class="step" style="--i: 3">
					<div class="step-card">
						<svg class="scene s8" viewBox="0 0 220 220" aria-hidden="true">
							<rect class="win" x="10" y="12" width="200" height="196" rx="14" />
							<circle class="td td-r" cx="26" cy="28" r="4.5" />
							<circle class="td td-y" cx="40" cy="28" r="4.5" />
							<circle class="td td-g" cx="54" cy="28" r="4.5" />
							<rect class="url" x="68" y="19" width="130" height="18" rx="9" />
							<text class="url-text" x="82" y="32">http://localhost:3000</text>
							<g class="s8-side">
								<rect class="panel" x="20" y="48" width="44" height="150" rx="8" />
								<rect class="skel" x="27" y="58" width="30" height="6" rx="3" />
								<rect class="skel" x="27" y="72" width="22" height="6" rx="3" />
								<rect class="skel" x="27" y="86" width="26" height="6" rx="3" />
							</g>
							<g class="s8-card s8-c1">
								<rect class="panel" x="72" y="48" width="126" height="56" rx="8" />
								<path class="spark" d="M82 92l16-14 14 8 18-20 16 10 22-18" />
							</g>
							<g class="s8-card s8-c2">
								<rect class="panel" x="72" y="112" width="60" height="86" rx="8" />
								<rect class="skel" x="80" y="124" width="40" height="6" rx="3" />
								<rect class="skel" x="80" y="138" width="30" height="6" rx="3" />
								<circle class="donut" cx="102" cy="170" r="14" />
							</g>
							<g class="s8-card s8-c3">
								<rect class="panel" x="138" y="112" width="60" height="86" rx="8" />
								<rect class="skel" x="146" y="124" width="44" height="6" rx="3" />
								<rect class="skel" x="146" y="138" width="32" height="6" rx="3" />
								<rect class="skel" x="146" y="152" width="40" height="6" rx="3" />
								<rect class="skel" x="146" y="166" width="26" height="6" rx="3" />
							</g>
							<rect
								class="s8-shimmer"
								x="72"
								y="48"
								width="126"
								height="150"
								rx="8"
							/>
							<g class="s8-cursor">
								<path d="M0 0v18l5-4.5 3.6 8.2 3.4-1.5-3.6-8H16z" class="cursor" />
							</g>
						</svg>
					</div>
					<span class="step-label"
						><span class="step-num" aria-hidden="true">4</span>{tr(
							'home.how.runner.step4'
						)}</span
					>
				</li>
			</ol>
		</div>
	</div>
</section>

<style>
	.defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}
	.stop-a {
		stop-color: var(--color-primary-button);
	}
	.stop-b {
		stop-color: var(--color-accent-light, var(--color-primary-button));
	}

	/* ---- layout ------------------------------------------------------------------------ */
	.how {
		padding: 4rem 0;
	}

	.how h2 {
		text-align: center;
		font-size: 2rem;
		margin-bottom: 3rem;
		color: var(--color-text);
	}

	.how-subflow {
		margin-top: 3.5rem;
		padding-top: 2.5rem;
		border-top: 1px solid var(--color-border);
	}

	.how-subflow h3 {
		text-align: center;
		font-size: 1.35rem;
		margin-bottom: 0.5rem;
		color: var(--color-text);
	}

	.how-subtitle {
		text-align: center;
		color: var(--color-text-muted);
		max-width: 700px;
		margin: 0 auto 2.25rem;
		line-height: 1.5;
	}

	.flow {
		max-width: 1100px;
		margin: 0 auto;
	}

	.steps {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		text-align: center;
		flex: 1;
		min-width: 0;
	}

	.step-card {
		position: relative;
		width: 100%;
		max-width: 232px;
		aspect-ratio: 1;
		border-radius: 22px;
		overflow: hidden;
		border: 1px solid var(--color-fixed-border-strong);
		background:
			radial-gradient(
				120% 80% at 50% 0%,
				color-mix(in srgb, var(--color-primary-button) 26%, transparent),
				transparent 62%
			),
			var(--color-fixed-surface-discord-strong);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
		transition:
			transform 0.25s ease,
			box-shadow 0.25s ease,
			border-color 0.25s ease;
	}

	.step:hover .step-card {
		transform: translateY(-6px);
		border-color: color-mix(in srgb, var(--color-primary-button) 60%, transparent);
		box-shadow:
			0 18px 40px rgba(0, 0, 0, 0.35),
			0 0 0 1px color-mix(in srgb, var(--color-primary-button) 40%, transparent);
	}

	.step-num {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-right: 0.5rem;
		border-radius: 50%;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-primary-button-text);
		background: var(--color-primary-button);
		vertical-align: 1px;
	}

	.scene {
		display: block;
		width: 100%;
		height: 100%;
	}

	.step-label {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.step-connector {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		/* Centre on the card, not on the card plus its label. */
		align-self: flex-start;
		height: min(232px, 22vw);
	}
	.flow-arrow-line,
	.flow-arrow-head {
		stroke: var(--color-primary-button);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		fill: none;
	}
	.flow-arrow-line {
		stroke-dasharray: 4 6;
		opacity: 0.8;
	}
	.flow-arrow-head {
		opacity: 0.9;
	}

	/* ---- scene parts (colours come from the theme tokens) ------------------------------- */
	.halo {
		fill: url(#hiw-halo);
	}
	.halo-a {
		stop-color: var(--color-primary-button);
		stop-opacity: 0.42;
	}
	.halo-b {
		stop-color: var(--color-primary-button);
		stop-opacity: 0;
	}
	.win,
	.term {
		fill: var(--color-fixed-surface-discord);
		stroke: var(--color-fixed-border-strong);
	}
	.win-bar {
		fill: var(--color-fixed-surface-discord-alt);
	}
	.chan,
	.who,
	.said,
	.menu-cmd,
	.typed,
	.cmd,
	.ok-text,
	.btn-text,
	.url-text,
	.host,
	.chip text {
		font-family: inherit;
	}
	.chan {
		font-size: 10px;
		font-weight: 700;
		fill: var(--color-fixed-text-muted);
	}
	.who {
		font-size: 11px;
		font-weight: 700;
		fill: var(--color-accent-light, var(--color-primary-button));
	}
	.said {
		font-size: 12px;
		fill: var(--color-fixed-text-secondary);
	}
	.slash {
		fill: var(--color-accent-light, var(--color-primary-button));
		font-weight: 700;
	}
	.input,
	.menu {
		fill: var(--color-fixed-surface-discord-alt);
		stroke: var(--color-fixed-border-strong);
	}
	.menu-cmd {
		font-size: 12px;
		font-weight: 600;
		fill: var(--color-fixed-text-bright);
	}
	.menu-line,
	.skel {
		fill: var(--color-fixed-border-strong);
	}
	.typed {
		font-size: 13px;
		fill: var(--color-fixed-text-bright);
	}
	.blurple {
		fill: #5865f2;
	}
	.glyph {
		fill: var(--color-fixed-text-bright);
	}
	.btn-text {
		font-size: 15px;
		font-weight: 700;
		fill: var(--color-fixed-text-bright);
	}
	.avatar-bg {
		fill: url(#hiw-brand);
	}
	.avatar-fg {
		fill: var(--color-fixed-text-secondary);
	}
	.badge-ok,
	.chip-dot,
	.live-dot {
		fill: var(--color-success);
	}
	.tick,
	.ok-tick {
		fill: none;
		stroke: var(--color-fixed-surface-discord-strong);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ok-tick {
		stroke: var(--color-success);
	}
	.pill {
		fill: var(--color-fixed-border-strong);
	}
	.cursor {
		fill: var(--color-fixed-text-bright);
		stroke: var(--color-fixed-surface-discord-strong);
		stroke-width: 1.4;
		stroke-linejoin: round;
	}
	.s1-ring circle {
		fill: none;
		stroke: var(--color-fixed-text-bright);
		stroke-width: 2;
	}

	.rail {
		fill: var(--color-fixed-surface-discord);
		stroke: var(--color-fixed-border-strong);
	}
	.srv {
		fill: var(--color-fixed-surface-discord-muted);
	}
	.divider {
		stroke: var(--color-fixed-border-strong);
		stroke-width: 3;
		stroke-linecap: round;
	}
	.slot {
		fill: none;
		stroke: var(--color-fixed-text-faint);
		stroke-width: 2;
		stroke-dasharray: 5 5;
	}
	.slot-plus {
		stroke: var(--color-fixed-text-faint);
		stroke-width: 2.4;
		stroke-linecap: round;
	}
	.bot-ring {
		fill: none;
		stroke: var(--color-primary-button);
		stroke-width: 3;
	}
	.s2-pulse circle {
		fill: none;
		stroke: var(--color-primary-button);
		stroke-width: 3;
	}
	.s2-spark path {
		fill: var(--color-warning);
	}

	.s3-dots circle {
		fill: var(--color-fixed-text-muted);
	}
	.embed {
		fill: var(--color-fixed-surface-discord-alt);
	}
	.embed-edge {
		fill: var(--color-success);
	}

	.grid-line {
		stroke: var(--color-fixed-border);
		stroke-width: 1;
	}
	.bar {
		fill: var(--color-primary-button);
	}
	.bar:nth-of-type(even) {
		opacity: 0.8;
	}
	.s4-line {
		fill: none;
		stroke: var(--color-success);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.s4-dot {
		fill: var(--color-success);
		stroke: var(--color-fixed-surface-discord);
		stroke-width: 2;
	}
	.live-ring {
		fill: none;
		stroke: var(--color-success);
		stroke-width: 2;
		opacity: 0.5;
	}

	.td-r {
		fill: #ed4245;
	}
	.td-y {
		fill: var(--color-warning);
	}
	.td-g {
		fill: var(--color-success);
	}
	.cmd {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
		font-size: 12px;
		fill: var(--color-fixed-text-secondary);
	}
	.prompt {
		fill: var(--color-success);
	}
	.s5-caret {
		fill: var(--color-fixed-text-bright);
	}
	.ok-text {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
		font-size: 12px;
		fill: var(--color-success);
	}

	.laptop {
		fill: var(--color-fixed-surface-discord-alt);
		stroke: var(--color-fixed-border-strong);
		stroke-width: 2;
	}
	.laptop-base {
		fill: var(--color-fixed-surface-discord-muted);
	}
	.cloud {
		fill: var(--color-fixed-surface-discord-alt);
		stroke: var(--color-primary-button);
		stroke-width: 2.4;
	}
	.pipe {
		stroke: var(--color-fixed-border-strong);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.s7-flow {
		stroke: var(--color-primary-button);
		stroke-width: 2.4;
		stroke-dasharray: 3 7;
		stroke-linecap: round;
	}
	.packet {
		fill: var(--color-accent-light, var(--color-primary-button));
	}
	.chip rect {
		fill: var(--color-fixed-surface-discord-alt);
		stroke: var(--color-fixed-border-strong);
	}
	.chip text {
		font-size: 13px;
		font-weight: 600;
		fill: var(--color-fixed-text-bright);
	}
	.chip-pulse {
		fill: var(--color-success);
		opacity: 0.35;
	}
	.host {
		font-size: 10px;
		fill: var(--color-fixed-text-muted);
	}

	.url {
		fill: var(--color-fixed-surface-discord-alt);
	}
	.url-text {
		font-size: 9.5px;
		fill: var(--color-fixed-text-muted);
	}
	.panel {
		fill: var(--color-fixed-surface-discord-alt);
		stroke: var(--color-fixed-border);
	}
	.spark {
		fill: none;
		stroke: var(--color-primary-button);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.donut {
		fill: none;
		stroke: var(--color-warning);
		stroke-width: 7;
		stroke-dasharray: 54 100;
		transform: rotate(-90deg);
		transform-box: fill-box;
		transform-origin: center;
	}
	.s8-shimmer {
		fill: url(#hiw-brand);
		opacity: 0;
	}

	/* ---- the stills: what each scene looks like with no motion --------------------------- */
	.s1-chip,
	.s1-ring,
	.s1-cursor,
	.s2-pulse,
	.s2-spark,
	.s3-dots,
	.s3-menu,
	.s3-caret,
	.s6-menu,
	.s6-caret,
	.s5-caret,
	.s5-bars {
		opacity: 0;
	}
	.s3-cover,
	.s5-cover,
	.s6-cover {
		fill: var(--color-fixed-surface-discord-alt);
		opacity: 0;
	}
	.s5-cover {
		fill: var(--color-fixed-surface-discord);
	}
	.s4-dot {
		opacity: 1;
	}
	.s7-p1,
	.s7-p2,
	.s7-p3 {
		opacity: 0;
	}
	.s7-p2 {
		opacity: 1;
		transform: translateX(34px);
	}
	.s8-cursor {
		opacity: 0;
	}

	/* Every animated piece scales and turns about its own middle. */
	.s1-btn,
	.s1-chip,
	.s1-ring circle,
	.s2-bot,
	.s2-pulse circle,
	.s2-spark,
	.s3-reply,
	.s3-dots,
	.s3-menu,
	.s4-bar,
	.s4-dot,
	.s4-live,
	.s6-embed,
	.s6-menu,
	.s8-card,
	.chip-pulse {
		transform-box: fill-box;
		transform-origin: center;
	}
	.s4-bar {
		transform-origin: bottom center;
	}
	.s3-cover,
	.s6-cover,
	.s5-cover {
		transform-box: fill-box;
		transform-origin: right center;
	}

	/* ---- motion ------------------------------------------------------------------------ */
	@media (prefers-reduced-motion: no-preference) {
		.scene,
		.flow-arrow-line {
			--dur: 7s;
		}

		/* Steps slide in once, in order, the first time a flow is seen. */
		.flow:global(.armed) .step,
		.flow:global(.armed) .step-connector {
			opacity: 0;
			transform: translateY(18px);
		}
		.flow:global(.armed):global(.seen) .step,
		.flow:global(.armed):global(.seen) .step-connector {
			opacity: 1;
			transform: none;
			transition:
				opacity 0.6s ease,
				transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
			transition-delay: calc(var(--i, 0) * 0.14s);
		}
		.flow:global(.armed):global(.seen) .step-connector {
			transition-delay: 0.3s;
		}

		/* Run only while on screen. */
		.flow:not(:global(.playing)) :is(.scene, .scene *, .flow-arrow-line) {
			animation-play-state: paused;
		}

		.flow-arrow-line {
			animation: arrow-flow 1.1s linear infinite;
		}
		@keyframes arrow-flow {
			to {
				stroke-dashoffset: -20;
			}
		}

		/* 1 — click Login, get signed in */
		.s1-cursor {
			animation: s1-cursor var(--dur) ease-in-out infinite;
		}
		.s1-btn {
			animation: s1-btn var(--dur) ease-in-out infinite;
		}
		.s1-ring circle {
			animation: s1-ring var(--dur) ease-out infinite;
		}
		.s1-chip {
			animation: s1-chip var(--dur) ease-in-out infinite;
		}
		@keyframes s1-cursor {
			0% {
				transform: translate(200px, 200px);
				opacity: 0;
			}
			8% {
				opacity: 1;
			}
			30% {
				transform: translate(126px, 112px);
				opacity: 1;
			}
			36% {
				transform: translate(126px, 112px) scale(0.86);
			}
			41% {
				transform: translate(126px, 112px) scale(1);
				opacity: 1;
			}
			58% {
				transform: translate(160px, 160px);
				opacity: 1;
			}
			66%,
			100% {
				transform: translate(200px, 200px);
				opacity: 0;
			}
		}
		@keyframes s1-btn {
			0%,
			34% {
				transform: scale(1);
				opacity: 1;
			}
			38% {
				transform: scale(0.94);
			}
			42% {
				transform: scale(1);
				opacity: 1;
			}
			49%,
			92% {
				transform: scale(0.85);
				opacity: 0;
			}
			98%,
			100% {
				transform: scale(1);
				opacity: 1;
			}
		}
		@keyframes s1-ring {
			0%,
			36% {
				opacity: 0;
				transform: scale(0.3);
			}
			38% {
				opacity: 0.8;
			}
			56%,
			100% {
				opacity: 0;
				transform: scale(5.5);
			}
		}
		@keyframes s1-chip {
			0%,
			46% {
				opacity: 0;
				transform: scale(0.55);
			}
			55% {
				opacity: 1;
				transform: scale(1.08);
			}
			60%,
			90% {
				opacity: 1;
				transform: scale(1);
			}
			96%,
			100% {
				opacity: 0;
				transform: scale(0.9);
			}
		}

		/* 2 — the bot drops into the server list */
		.s2-bot {
			animation: s2-bot var(--dur) ease-in-out infinite;
		}
		.slot {
			animation: s2-slot var(--dur) ease-in-out infinite;
		}
		.s2-pulse {
			opacity: 1;
		}
		.s2-pulse circle {
			animation: s2-pulse var(--dur) ease-out infinite;
		}
		.s2-spark {
			opacity: 1;
		}
		.s2-spark-a {
			animation: s2-spark var(--dur) ease-in-out infinite;
		}
		.s2-spark-b {
			animation: s2-spark var(--dur) ease-in-out 0.12s infinite;
		}
		.s2-spark-c {
			animation: s2-spark var(--dur) ease-in-out 0.24s infinite;
		}
		@keyframes s2-bot {
			0% {
				transform: translateY(-170px);
				opacity: 0;
			}
			8% {
				opacity: 1;
			}
			26% {
				transform: translateY(0);
			}
			32% {
				transform: translateY(-14px);
			}
			38%,
			90% {
				transform: translateY(0);
				opacity: 1;
			}
			96%,
			100% {
				transform: translateY(-170px);
				opacity: 0;
			}
		}
		@keyframes s2-slot {
			0%,
			24% {
				opacity: 1;
			}
			30%,
			92% {
				opacity: 0;
			}
			100% {
				opacity: 1;
			}
		}
		@keyframes s2-pulse {
			0%,
			27% {
				opacity: 0;
				transform: scale(1);
			}
			29% {
				opacity: 0.9;
			}
			52%,
			100% {
				opacity: 0;
				transform: scale(2.6);
			}
		}
		@keyframes s2-spark {
			0%,
			28% {
				opacity: 0;
				transform: scale(0) rotate(0deg);
			}
			38% {
				opacity: 1;
				transform: scale(1.2) rotate(40deg);
			}
			56%,
			100% {
				opacity: 0;
				transform: scale(0.3) rotate(90deg);
			}
		}

		/* 3 — type a command, see the reply */
		.s3-cover {
			opacity: 1;
			animation: s3-cover var(--dur) linear infinite;
		}
		.s3-caret {
			animation: s3-caret var(--dur) linear infinite;
		}
		.s3-menu {
			animation: s3-menu var(--dur) ease-in-out infinite;
		}
		.s3-dots {
			animation: s3-dots var(--dur) ease-in-out infinite;
		}
		.s3-dots circle {
			animation: dot-bounce 0.7s ease-in-out infinite;
			transform-box: fill-box;
			transform-origin: center;
		}
		.s3-dots circle:nth-child(2) {
			animation-delay: 0.12s;
		}
		.s3-dots circle:nth-child(3) {
			animation-delay: 0.24s;
		}
		.s3-reply {
			animation: s3-reply var(--dur) ease-in-out infinite;
		}
		@keyframes s3-cover {
			0%,
			10% {
				transform: scaleX(1);
				animation-timing-function: steps(12, end);
			}
			40%,
			46% {
				transform: scaleX(0);
			}
			47%,
			100% {
				transform: scaleX(1);
			}
		}
		@keyframes s3-caret {
			0%,
			9% {
				opacity: 0;
				transform: translateX(0);
			}
			10% {
				opacity: 1;
				transform: translateX(0);
				animation-timing-function: steps(12, end);
			}
			40% {
				opacity: 1;
				transform: translateX(86px);
			}
			46% {
				opacity: 1;
			}
			47%,
			100% {
				opacity: 0;
				transform: translateX(0);
			}
		}
		@keyframes s3-menu {
			0%,
			8% {
				opacity: 0;
				transform: translateY(8px);
			}
			14%,
			42% {
				opacity: 1;
				transform: translateY(0);
			}
			47%,
			100% {
				opacity: 0;
				transform: translateY(8px);
			}
		}
		@keyframes s3-dots {
			0%,
			49% {
				opacity: 0;
			}
			51%,
			60% {
				opacity: 1;
			}
			62%,
			100% {
				opacity: 0;
			}
		}
		@keyframes dot-bounce {
			0%,
			100% {
				transform: translateY(0);
			}
			50% {
				transform: translateY(-4px);
			}
		}
		@keyframes s3-reply {
			0%,
			60% {
				opacity: 0;
				transform: translateY(10px) scale(0.96);
			}
			67%,
			92% {
				opacity: 1;
				transform: translateY(0) scale(1);
			}
			98%,
			100% {
				opacity: 0;
				transform: translateY(0) scale(1);
			}
		}

		/* 4 — bars grow, the trend line draws, the live light pulses */
		.s4-bar {
			animation: s4-bar var(--dur) cubic-bezier(0.2, 0.8, 0.2, 1) var(--d) infinite;
		}
		.s4-line {
			stroke-dasharray: 100;
			animation: s4-line var(--dur) ease-in-out infinite;
		}
		.s4-dot {
			animation: s4-dot var(--dur) ease-in-out infinite;
		}
		.s4-live {
			animation: live-pulse 1.8s ease-in-out infinite;
		}
		@keyframes s4-bar {
			0% {
				transform: scaleY(0);
			}
			22%,
			62% {
				transform: scaleY(1);
			}
			72% {
				transform: scaleY(0.78);
			}
			82%,
			92% {
				transform: scaleY(1);
			}
			98%,
			100% {
				transform: scaleY(0);
			}
		}
		@keyframes s4-line {
			0%,
			24% {
				stroke-dashoffset: 100;
			}
			52%,
			92% {
				stroke-dashoffset: 0;
			}
			98%,
			100% {
				stroke-dashoffset: 100;
			}
		}
		@keyframes s4-dot {
			0%,
			50% {
				opacity: 0;
				transform: scale(0);
			}
			56% {
				opacity: 1;
				transform: scale(1.5);
			}
			62%,
			92% {
				opacity: 1;
				transform: scale(1);
			}
			98%,
			100% {
				opacity: 0;
			}
		}
		@keyframes live-pulse {
			0%,
			100% {
				transform: scale(1);
				opacity: 1;
			}
			50% {
				transform: scale(1.35);
				opacity: 0.45;
			}
		}

		/* 5 — start the runner in a terminal */
		.s5-cover {
			opacity: 1;
			animation: s5-cover var(--dur) linear infinite;
		}
		.s5-caret {
			animation: s5-caret var(--dur) linear infinite;
		}
		.s5-ok {
			animation: s5-ok var(--dur) ease-in-out infinite;
		}
		.s5-bars {
			opacity: 1;
			animation: s5-bars var(--dur) ease-in-out infinite;
		}
		@keyframes s5-cover {
			0%,
			8% {
				transform: scaleX(1);
				animation-timing-function: steps(20, end);
			}
			38%,
			96% {
				transform: scaleX(0);
			}
			100% {
				transform: scaleX(1);
			}
		}
		@keyframes s5-caret {
			0%,
			7% {
				opacity: 1;
				transform: translateX(0);
			}
			8% {
				opacity: 1;
				animation-timing-function: steps(20, end);
			}
			38% {
				opacity: 1;
				transform: translateX(160px);
			}
			42% {
				opacity: 0;
			}
			46% {
				opacity: 1;
				transform: translateX(160px);
			}
			50% {
				opacity: 0;
			}
			54%,
			96% {
				opacity: 1;
				transform: translateX(160px);
			}
			98%,
			100% {
				opacity: 0;
				transform: translateX(0);
			}
		}
		@keyframes s5-ok {
			0%,
			42% {
				opacity: 0;
				transform: translateX(-8px);
			}
			50%,
			92% {
				opacity: 1;
				transform: translateX(0);
			}
			98%,
			100% {
				opacity: 0;
			}
		}
		@keyframes s5-bars {
			0%,
			52% {
				opacity: 0;
			}
			62%,
			92% {
				opacity: 0.8;
			}
			98%,
			100% {
				opacity: 0;
			}
		}

		/* 6 — connect from Discord */
		.s6-cover {
			opacity: 1;
			animation: s6-cover var(--dur) linear infinite;
		}
		.s6-caret {
			animation: s6-caret var(--dur) linear infinite;
		}
		.s6-menu {
			animation: s3-menu var(--dur) ease-in-out infinite;
		}
		.s6-embed {
			animation: s3-reply var(--dur) ease-in-out infinite;
		}
		@keyframes s6-cover {
			0%,
			10% {
				transform: scaleX(1);
				animation-timing-function: steps(15, end);
			}
			40%,
			46% {
				transform: scaleX(0);
			}
			47%,
			100% {
				transform: scaleX(1);
			}
		}
		@keyframes s6-caret {
			0%,
			9% {
				opacity: 0;
				transform: translateX(0);
			}
			10% {
				opacity: 1;
				transform: translateX(0);
				animation-timing-function: steps(15, end);
			}
			40% {
				opacity: 1;
				transform: translateX(108px);
			}
			46% {
				opacity: 1;
			}
			47%,
			100% {
				opacity: 0;
				transform: translateX(0);
			}
		}

		/* 7 — packets run through the tunnel */
		.s7-flow {
			animation: tunnel-flow 0.9s linear infinite;
		}
		.s7-p1 {
			animation: packet var(--dur) ease-in-out infinite;
		}
		.s7-p2 {
			animation: packet var(--dur) ease-in-out 0.45s infinite;
		}
		.s7-p3 {
			animation: packet-back var(--dur) ease-in-out 0.9s infinite;
		}
		.chip-pulse {
			animation: chip-pulse 1.6s ease-out infinite;
		}
		@keyframes tunnel-flow {
			to {
				stroke-dashoffset: -20;
			}
		}
		@keyframes packet {
			0%,
			6% {
				opacity: 0;
				transform: translateX(0) scale(0.6);
			}
			14% {
				opacity: 1;
				transform: translateX(0) scale(1);
			}
			34% {
				opacity: 1;
				transform: translateX(64px) scale(1);
			}
			40%,
			100% {
				opacity: 0;
				transform: translateX(68px) scale(0.5);
			}
		}
		@keyframes packet-back {
			0%,
			6% {
				opacity: 0;
				transform: translateX(64px) scale(0.6);
			}
			14% {
				opacity: 1;
				transform: translateX(64px) scale(1);
			}
			34% {
				opacity: 1;
				transform: translateX(0) scale(1);
			}
			40%,
			100% {
				opacity: 0;
				transform: translateX(-4px) scale(0.5);
			}
		}
		@keyframes chip-pulse {
			0% {
				opacity: 0.5;
				transform: scale(1);
			}
			100% {
				opacity: 0;
				transform: scale(2.4);
			}
		}

		/* 8 — open the tools in the browser */
		.s8-side,
		.s8-card {
			animation: s8-in var(--dur) ease-out infinite;
		}
		.s8-c1 {
			animation-delay: 0.15s;
		}
		.s8-c2 {
			animation-delay: 0.3s;
		}
		.s8-c3 {
			animation-delay: 0.45s;
		}
		.s8-shimmer {
			animation: s8-shimmer var(--dur) ease-in-out infinite;
		}
		.s8-cursor {
			opacity: 1;
			animation: s8-cursor var(--dur) ease-in-out infinite;
		}
		@keyframes s8-in {
			0% {
				opacity: 0;
				transform: translateY(10px) scale(0.97);
			}
			14%,
			90% {
				opacity: 1;
				transform: translateY(0) scale(1);
			}
			97%,
			100% {
				opacity: 0;
				transform: translateY(0) scale(1);
			}
		}
		@keyframes s8-shimmer {
			0% {
				opacity: 0.28;
				transform: translateX(-30px);
			}
			14% {
				opacity: 0;
				transform: translateX(30px);
			}
			100% {
				opacity: 0;
			}
		}
		@keyframes s8-cursor {
			0%,
			32% {
				transform: translate(190px, 196px);
				opacity: 0;
			}
			40% {
				opacity: 1;
			}
			56% {
				transform: translate(150px, 80px);
			}
			68% {
				transform: translate(110px, 170px);
			}
			80% {
				transform: translate(160px, 150px);
				opacity: 1;
			}
			90%,
			100% {
				transform: translate(190px, 196px);
				opacity: 0;
			}
		}
	}

	/* ---- small screens ------------------------------------------------------------------ */
	@media (max-width: 700px) {
		.steps {
			flex-direction: column;
			align-items: center;
			gap: 0.25rem;
		}
		.step {
			width: 100%;
		}
		.step-connector {
			height: auto;
			align-self: center;
			padding: 0.25rem 0;
		}
		.step-connector svg {
			transform: rotate(90deg);
		}
		.step-card {
			max-width: 240px;
		}
		.how h2 {
			font-size: 1.5rem;
		}
	}
</style>
