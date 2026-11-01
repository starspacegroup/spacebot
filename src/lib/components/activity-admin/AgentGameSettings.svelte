<script lang="ts">
	/**
	 * Hidden Agent settings, inside its card on the Activity admin page.
	 * Posts to `?/saveGame`, unchanged from before the Games section.
	 */
	import { enhance } from '$app/forms';
	import type { GameSettingsProps } from './game-settings.js';

	const { data, keepValues }: GameSettingsProps = $props();
	const L = $derived(data.gameLimits);
</script>

<p class="sb-note">
	Changes apply to the next round, not one already running. Players can still message each other
	privately, so this is an honour-system game, not a locked-down one.
</p>
<form method="POST" action="?/saveGame" use:enhance={keepValues} class="sb-settings-form">
	<label>
		Name for the hidden role
		<input type="text" name="agentName" maxlength="20" value={data.game.agentName} required />
	</label>
	<label>
		Name for everyone else
		<input type="text" name="crewName" maxlength="20" value={data.game.crewName} required />
	</label>
	<label>
		Players needed to start
		<input
			type="number"
			name="minPlayers"
			min={L.minPlayers[0]}
			max={L.minPlayers[1]}
			value={data.game.minPlayers}
			required
		/>
	</label>
	<label>
		Round length (seconds)
		<input
			type="number"
			name="roundSeconds"
			min={L.roundSeconds[0]}
			max={L.roundSeconds[1]}
			value={data.game.roundSeconds}
			required
		/>
	</label>
	<label>
		Votes locked for the first (seconds)
		<input
			type="number"
			name="callLockSeconds"
			min={L.callLockSeconds[0]}
			max={L.callLockSeconds[1]}
			value={data.game.callLockSeconds}
			required
		/>
	</label>
	<label>
		A vote stays open for (seconds)
		<input
			type="number"
			name="meetingSeconds"
			min={L.meetingSeconds[0]}
			max={L.meetingSeconds[1]}
			value={data.game.meetingSeconds}
			required
		/>
	</label>
	<label>
		Votes each player may call
		<input
			type="number"
			name="callsPerPlayer"
			min={L.callsPerPlayer[0]}
			max={L.callsPerPlayer[1]}
			value={data.game.callsPerPlayer}
			required
		/>
	</label>
	<label class="check">
		<input type="checkbox" name="muteOut" checked={data.game.muteOut} />
		<span class="check-text">
			<span>Server-mute a player who is ejected</span>
			<span class="hint">
				They can still hear. Needs Mute Members and a bot role above theirs. The mute is
				lifted when the round ends, and a mute a moderator set is left alone.
			</span>
		</span>
	</label>
	<div class="actions">
		<button type="submit" class="sb-btn-primary">Save Hidden Agent settings</button>
	</div>
</form>
