const target =
	process.argv[2] || process.env.SPACEBOT_PUBLIC_URL || 'https://spacebot.starspace.group';

console.log(`HTTP/3 verification target: ${target}`);
console.log('1. In Cloudflare, open Speed > Optimization > Protocol Optimization.');
console.log('2. Confirm HTTP/3 (QUIC) is enabled for the zone.');
console.log('3. Run: curl --http3 -I ' + target);
console.log('4. Confirm the response succeeds and Cloudflare returns alt-svc with h3.');
