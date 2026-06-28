function escapeCsv(value: any): string {
	const text = value === null || value === undefined ? '' : String(value);
	return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows: Record<string, any>[], section: string): string {
	if (!rows.length) return `section\n${escapeCsv(section)}\n`;
	const fields = ['section', ...Object.keys(rows[0])];
	const lines = [fields.join(',')];
	for (const row of rows) {
		lines.push(
			[section, ...fields.slice(1).map((field) => row[field])].map(escapeCsv).join(',')
		);
	}
	return lines.join('\n');
}

export function statsExportToCsv(exportData: any): string {
	return [
		rowsToCsv(exportData.server_stats || [], 'server_stats'),
		rowsToCsv(exportData.aggregated_stats || [], 'aggregated_stats'),
		rowsToCsv(exportData.voice_sessions || [], 'voice_sessions'),
	].join('\n\n');
}
