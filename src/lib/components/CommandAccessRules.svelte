<script lang="ts">
	import RoleSelector from './RoleSelector.svelte';

	/**
	 * Role rules for who may run a command, layered on its permission level:
	 * roles that are let in without the permission, and roles kept out with it.
	 * Submits `allow_roles` and `deny_roles` as comma-separated role ids.
	 */
	const {
		guildId,
		allow = [],
		deny = [],
		permissionLevelSet = false,
	}: {
		guildId: string;
		allow?: string[];
		deny?: string[];
		/** Whether the permission level above is anything other than Everyone. */
		permissionLevelSet?: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	let allowValue = $state(allow.join(','));
	// svelte-ignore state_referenced_locally
	let denyValue = $state(deny.join(','));
</script>

<div class="access-rules">
	<div class="form-group">
		<label for="allow_roles_search">Also allow these roles</label>
		<RoleSelector
			{guildId}
			name="allow_roles"
			multiple={true}
			bind:value={allowValue}
			placeholder="Search roles..."
		/>
		<p class="field-hint">
			Members with any of these roles can use the command even without the permission level
			above. Administrators can always use it.
			{#if allowValue && permissionLevelSet}
				Discord will show the command to everyone, and SpaceBot checks who may actually run
				it.
			{/if}
		</p>
	</div>

	<div class="form-group">
		<label for="deny_roles_search">Never allow these roles</label>
		<RoleSelector
			{guildId}
			name="deny_roles"
			multiple={true}
			bind:value={denyValue}
			placeholder="Search roles..."
		/>
		<p class="field-hint">
			Members with any of these roles cannot use the command, whatever else they have.
			Administrators are not affected. If a role is in both lists, it is denied.
		</p>
	</div>
</div>

<style>
	.access-rules {
		margin-top: 1rem;
		display: grid;
		gap: 1rem;
	}
</style>
