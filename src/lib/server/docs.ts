/**
 * Developer documentation, rendered from the repo's `docs/*.md` files and
 * served on the main site under /docs/dev. Replaces the old Jekyll → GitHub
 * Pages pipeline: the markdown is compiled to HTML at build time (these routes
 * prerender), so no external docs host is involved.
 */
import { Marked } from 'marked';

const GITHUB_BLOB = 'https://github.com/starspacegroup/spacebot/blob/main';

// Raw markdown for every top-level doc, bundled at build time. The key is the
// absolute-from-project-root path (e.g. "/docs/architecture.md").
const RAW_DOCS = import.meta.glob('/docs/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

export interface DocMeta {
	slug: string;
	title: string;
	description: string;
}

export interface DocHeading {
	id: string;
	text: string;
	level: number;
}

export interface RenderedDoc extends DocMeta {
	html: string;
	headings: DocHeading[];
}

// Curated order + grouping, mirroring the old docs/index.md landing page.
// Docs not listed here still render; they just sort to the end alphabetically.
const SECTIONS: Array<{ title: string; slugs: string[] }> = [
	{ title: 'Start here', slugs: ['architecture', 'api', 'integrations'] },
	{
		title: 'Features & subsystems',
		slugs: ['ai-autopilot', 'local-runner-v2', 'superadmin-workflows', 'server-browser'],
	},
	{ title: 'Operations', slugs: ['observability', 'alerts', 'http3', 'assets'] },
	{ title: 'Guides', slugs: ['tutorials'] },
];

function slugFromPath(path: string): string {
	return path.replace(/^.*\/([^/]+)\.md$/, '$1');
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

/** Strip Jekyll front matter, returning the body and any parsed `title`. */
function stripFrontMatter(raw: string): { body: string; title?: string } {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
	if (!match) return { body: raw };
	const titleLine = /(?:^|\n)title:\s*(.+)\s*(?:\n|$)/.exec(match[1]);
	const title = titleLine ? titleLine[1].replace(/^["']|["']$/g, '').trim() : undefined;
	return { body: raw.slice(match[0].length), title };
}

/**
 * Rewrite links to sibling docs so they resolve on-site; anything pointing
 * outside the rendered set (../CLAUDE.md, grafana/README.md, …) falls back to
 * the file on GitHub so the link still works.
 */
function rewriteDocHref(href: string, knownSlugs: Set<string>): string {
	if (!href.endsWith('.md') && !href.includes('.md#')) return href;

	const [pathPart, anchor] = href.split('#');
	const cleanAnchor = anchor ? `#${anchor}` : '';

	// Bare sibling doc, e.g. "architecture.md"
	if (!pathPart.includes('/')) {
		const slug = pathPart.replace(/\.md$/, '');
		if (knownSlugs.has(slug)) return `/docs/dev/${slug}${cleanAnchor}`;
	}

	// Outside the set: resolve to the GitHub blob. `../foo` climbs out of docs/.
	if (pathPart.startsWith('../')) {
		return `${GITHUB_BLOB}/${pathPart.replace(/^\.\.\//, '')}${cleanAnchor}`;
	}
	return `${GITHUB_BLOB}/docs/${pathPart}${cleanAnchor}`;
}

function firstParagraph(body: string): string {
	for (const block of body.split(/\n\s*\n/)) {
		const line = block.trim();
		if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|')) continue;
		return line
			.replace(/[*_`[\]]/g, '')
			.replace(/\]\([^)]*\)/g, '')
			.slice(0, 200);
	}
	return '';
}

function renderDoc(slug: string, raw: string): RenderedDoc {
	const { body, title: fmTitle } = stripFrontMatter(raw);
	const knownSlugs = new Set(Object.keys(RAW_DOCS).map(slugFromPath));
	const headings: DocHeading[] = [];
	const seenIds = new Map<string, number>();

	const marked = new Marked({ gfm: true, breaks: false });
	marked.use({
		renderer: {
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				const plain = text.replace(/<[^>]+>/g, '');
				let id = slugify(plain);
				const count = seenIds.get(id) ?? 0;
				seenIds.set(id, count + 1);
				if (count > 0) id = `${id}-${count}`;
				if (depth <= 3) headings.push({ id, text: plain, level: depth });
				return `<h${depth} id="${id}">${text}</h${depth}>\n`;
			},
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens);
				const resolved = rewriteDocHref(href, knownSlugs);
				const external = /^https?:\/\//.test(resolved);
				const attrs = [
					`href="${resolved}"`,
					title ? `title="${title}"` : '',
					external ? 'target="_blank" rel="noopener noreferrer"' : '',
				]
					.filter(Boolean)
					.join(' ');
				return `<a ${attrs}>${text}</a>`;
			},
		},
	});

	// The leading H1 becomes the page title; drop it from the body to avoid
	// rendering the title twice.
	const h1 = /^#\s+(.+)$/m.exec(body);
	const title = fmTitle || (h1 ? h1[1].trim() : slug);
	const bodyWithoutH1 = h1 ? body.replace(h1[0], '') : body;

	// Wrap tables in a horizontally scrollable container so a wide table never
	// forces the whole page past the viewport width on mobile.
	const html = (marked.parse(bodyWithoutH1) as string)
		.replace(/<table>/g, '<div class="doc-table"><table>')
		.replace(/<\/table>/g, '</table></div>');

	return { slug, title, description: firstParagraph(bodyWithoutH1), html, headings };
}

/** Metadata for every doc, grouped into curated sections for the index. */
export function listDocSections(): Array<{ title: string; docs: DocMeta[] }> {
	const bySlug = new Map<string, DocMeta>();
	for (const [path, raw] of Object.entries(RAW_DOCS)) {
		const slug = slugFromPath(path);
		if (slug === 'index') continue; // the generated landing replaces docs/index.md
		const { title, description } = renderDoc(slug, raw);
		bySlug.set(slug, { slug, title, description });
	}

	const used = new Set<string>();
	const sections = SECTIONS.map((section) => ({
		title: section.title,
		docs: section.slugs
			.map((slug) => {
				used.add(slug);
				return bySlug.get(slug);
			})
			.filter((doc): doc is DocMeta => Boolean(doc)),
	})).filter((section) => section.docs.length > 0);

	const leftover = [...bySlug.values()]
		.filter((doc) => !used.has(doc.slug))
		.sort((a, b) => a.title.localeCompare(b.title));
	if (leftover.length > 0) sections.push({ title: 'More', docs: leftover });

	return sections;
}

/** Flat list of slugs, used to prerender every doc page. */
export function listDocSlugs(): string[] {
	return Object.keys(RAW_DOCS)
		.map(slugFromPath)
		.filter((slug) => slug !== 'index');
}

export function getDoc(slug: string): RenderedDoc | null {
	const entry = Object.entries(RAW_DOCS).find(([path]) => slugFromPath(path) === slug);
	if (!entry || slug === 'index') return null;
	return renderDoc(slug, entry[1]);
}
