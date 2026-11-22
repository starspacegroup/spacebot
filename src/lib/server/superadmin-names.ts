/** Server names for the superadmin log pages: id to name, for the ids actually shown. */
export async function serverNames(db: any, ids: Iterable<string | null | undefined>) {
	const wanted = [
		...new Set(
			[...ids].filter((id): id is string => Boolean(id) && /^\d{17,20}$/.test(String(id)))
		),
	];
	const out: Record<string, string> = {};
	if (!db) return out;
	for (let i = 0; i < wanted.length; i += 80) {
		const chunk = wanted.slice(i, i + 80);
		const { results } = await db
			.prepare(
				`SELECT guild_id, name FROM guild_metadata WHERE guild_id IN (${chunk.map(() => '?').join(',')})`
			)
			.bind(...chunk)
			.all();
		for (const r of (results ?? []) as { guild_id: string; name: string }[])
			out[r.guild_id] = r.name;
	}
	return out;
}

/** Every server with a name, for a filter dropdown. Capped. */
export async function serverChoices(db: any, limit = 500): Promise<{ id: string; name: string }[]> {
	if (!db) return [];
	const { results } = await db
		.prepare(
			`SELECT guild_id AS id, name FROM guild_metadata WHERE name IS NOT NULL ORDER BY name COLLATE NOCASE LIMIT ?`
		)
		.bind(limit)
		.all();
	return (results ?? []) as { id: string; name: string }[];
}
