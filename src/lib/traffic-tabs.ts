/** The tabs of the superadmin Site traffic page. (Not in +page.server.ts: a route file may only export its handlers.) */
export const TABS = ['overview', 'browser', 'audience'] as const;
export type Tab = (typeof TABS)[number];
