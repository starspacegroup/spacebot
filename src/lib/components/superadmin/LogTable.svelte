<script lang="ts">
	type Row = {
		key: string;
		at: string;
		kind: string;
		guild_id: string | null;
		user_id: string | null;
		user_name: string | null;
		title: string;
		detail: string | null;
		ok: boolean | null;
	};
	type Props = {
		rows: Row[];
		/** Names for server ids. */
		servers?: Record<string, string>;
		showServer?: boolean;
		showUser?: boolean;
		empty?: string;
	};
	const {
		rows,
		servers = {},
		showServer = true,
		showUser = true,
		empty = 'Nothing here.',
	}: Props = $props();

	function when(sql: string) {
		const d = new Date(sql.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime())
			? sql
			: d.toLocaleString('en-GB', {
					timeZone: 'UTC',
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
				}) + ' UTC';
	}
</script>

{#if rows.length === 0}
	<p class="muted">{empty}</p>
{:else}
	<div class="wrap">
		<table>
			<thead>
				<tr>
					<th>When</th>
					<th>What</th>
					{#if showServer}<th>Server</th>{/if}
					{#if showUser}<th>Who</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.key)}
					<tr class:bad={r.ok === false}>
						<td class="nowrap">{when(r.at)}</td>
						<td>
							<span class="kind">{r.kind}</span>
							<span class="title">{r.title}</span>
							{#if r.detail}<div class="detail">{r.detail}</div>{/if}
						</td>
						{#if showServer}
							<td>
								{#if r.guild_id}
									<a href={`/admin/superadmin/servers/${r.guild_id}`}
										>{servers[r.guild_id] ?? r.guild_id}</a
									>
								{:else}<span class="muted">–</span>{/if}
							</td>
						{/if}
						{#if showUser}
							<td>
								{#if r.user_id}
									<a href={`/admin/superadmin/users/${r.user_id}`}
										>{r.user_name ?? r.user_id}</a
									>
								{:else}<span class="muted">–</span>{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	th {
		font-weight: 600;
		color: var(--color-text-muted);
	}
	.nowrap {
		white-space: nowrap;
	}
	.kind {
		display: inline-block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.05rem 0.4rem;
		margin-right: 0.4rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.title {
		overflow-wrap: anywhere;
	}
	.detail {
		color: var(--color-text-muted);
		font-size: 0.82rem;
		overflow-wrap: anywhere;
	}
	tr.bad .title {
		color: var(--color-error, #e5484d);
	}
	.muted {
		color: var(--color-text-muted);
	}
</style>
