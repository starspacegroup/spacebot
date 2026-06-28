import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../src/lib/openapi.js';

mkdirSync('docs/generated', { recursive: true });
writeFileSync('docs/generated/openapi.json', `${JSON.stringify(openApiDocument, null, 2)}\n`);
console.log('Wrote docs/generated/openapi.json');
