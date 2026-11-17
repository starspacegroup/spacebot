# Share cards

What a link to a SpaceBot page looks like when it is pasted into Discord, X, Slack or a message.

## How it works

- `src/lib/seo/social.ts` holds one table. Each public route maps to a **card** (a 1200×630 image)
  and to the title and description in the preview. `socialFor(pathname)` finds the match.
- The root layout (`src/routes/+layout.svelte`) renders `SocialMeta.svelte` for every page, so the
  page gets `og:*` and `twitter:*` tags with a large image, the right URL and image alt text.
- The cards are PNG files in `static/og/`, drawn ahead of time by `bun scripts/generate-og-cards.ts`
  from the template in `src/lib/seo/og-svg.ts` (an SVG turned into a PNG by resvg). They are not
  drawn on request: Cloudflare Workers will not compile the WebAssembly that does it at runtime, so a
  live generator fell back to an SVG in production, which Discord and X will not show. Run the
  script after changing a card, the template or the mark, and commit the PNGs. A test checks that
  every card has a 1200×630 file.
- `/api/og?page=<card>` is the old address. It redirects to the card's PNG (an unknown name gets the
  home card) so links that already point at it keep working.
- Pages built from data write their own tags with `SocialMeta` and are marked `own: true` in the
  table, so the layout skips them and the page never has two sets: a listed server
  (`/servers/<id>`, uses the server's icon), a developer document (`/docs/dev/<slug>`) and a
  member profile (`/profile/...`).
- Any path not in the table gets the home card, not a bare logo. The card shows the astronaut mark
  from `src/lib/assets/spacebot-mark.png`.

## Adding a page

1. Add a card to `OG_CARDS` if the page deserves its own (keep the description under 90 characters;
   a test checks it fits the image), then run `bun scripts/generate-og-cards.ts` and commit the PNG.
2. Add a route to `ROUTES` with the title and description for the preview.
3. Add the path to the sitemap if the page is public (`src/lib/server/sitemap.ts`). A test checks
   that every sitemap page has its own card.

## Caveats

- Discord, X and others cache a card for a long time. After changing a card, a link already shared
  keeps the old picture until their cache expires. Their debuggers can force a refresh.
- The title uses one font weight. The generator loads a single Inter file.
