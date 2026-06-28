const proc = Bun.spawn(['bun', 'audit'], {
	stdout: 'inherit',
	stderr: 'inherit',
});

const code = await proc.exited;
if (code !== 0 && process.env.SPACEBOT_AUDIT_STRICT !== 'true') {
	console.warn(
		'Dependency audit reported findings. Set SPACEBOT_AUDIT_STRICT=true to fail on findings.'
	);
	process.exit(0);
}

process.exit(code);
