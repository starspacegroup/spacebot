import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
	stories: ['../src/lib/components/**/*.stories.@(js|ts|svelte)'],
	addons: [],
	framework: {
		name: '@storybook/sveltekit',
		options: {},
	},
};

export default config;
