<script lang="ts">
	/** A labelled countdown with a bar of the share left. */
	const {
		label,
		value,
		pct = 0,
		colour = 'var(--o)',
	} = $props<{ label: string; value: string; pct?: number; colour?: string }>();
</script>

<div class="clock" style:--clk={colour} role="timer" aria-label="{label}: {value}">
	<div class="k">{label}</div>
	<div class="v" aria-hidden="true">{value}</div>
	<div class="bar" aria-hidden="true"><i style:width="{pct}%"></i></div>
</div>
