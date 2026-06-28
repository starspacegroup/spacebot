<script lang="ts">
	/**
	 * ButtonEditor - Visual builder for Discord button components
	 * Allows creating rows of buttons with labels, styles, emojis, and per-button action sequences
	 * Mobile-first responsive design with drag-and-drop reordering
	 */
	import ActionFlowBuilder from './ActionFlowBuilder.svelte';

	let {
		value = $bindable([]),
		actionTypes = {},
		templateVariables = {},
		channels = null,
		roles = null,
		emojis: _emojis = null,
		guildId = '',
		userSources = [],
	} = $props();

	// Ensure we always have at least one row
	let rows = $state(value?.length > 0 ? value : [[createDefaultButton()]]);

	// Currently expanded button for action editing
	let expandedButton = $state(null); // "rowIndex-btnIndex"

	// Button being dragged
	let dragState = $state(null);

	// Sync rows to parent value
	$effect(() => {
		value = rows;
	});

	// Initialize from parent value
	$effect(() => {
		if (value && Array.isArray(value) && value.length > 0) {
			// Only update if structurally different
			if (JSON.stringify(value) !== JSON.stringify(rows)) {
				rows = value;
			}
		}
	});

	function createDefaultButton() {
		return {
			id: generateButtonId(),
			label: 'Click Me',
			style: 1,
			emoji: '',
			disabled: false,
			actions: [],
		};
	}

	function generateButtonId() {
		return 'btn_' + Math.random().toString(36).substring(2, 8);
	}

	// Button styles matching Discord's component styles
	const BUTTON_STYLES = [
		{ value: 1, label: 'Primary', color: '#5865F2', textColor: 'white' },
		{ value: 2, label: 'Secondary', color: '#4F545C', textColor: 'white' },
		{ value: 3, label: 'Success', color: '#3BA55C', textColor: 'white' },
		{ value: 4, label: 'Danger', color: '#ED4245', textColor: 'white' },
		{ value: 5, label: 'Link', color: '#4F545C', textColor: '#00AFF4' },
	];

	function getStyleInfo(styleValue) {
		return BUTTON_STYLES.find((s) => s.value === styleValue) || BUTTON_STYLES[0];
	}

	function addButton(rowIndex) {
		if (rows[rowIndex].length >= 5) return; // Max 5 per row
		rows = rows.map((row, i) => (i === rowIndex ? [...row, createDefaultButton()] : row));
	}

	function addRow() {
		if (rows.length >= 5) return; // Max 5 rows
		rows = [...rows, [createDefaultButton()]];
	}

	function removeButton(rowIndex, btnIndex) {
		const newRows = rows
			.map((row, ri) => {
				if (ri !== rowIndex) return row;
				return row.filter((_, bi) => bi !== btnIndex);
			})
			.filter((row) => row.length > 0);
		rows = newRows.length > 0 ? newRows : [[createDefaultButton()]];
		expandedButton = null;
	}

	function removeRow(rowIndex) {
		rows = rows.filter((_, i) => i !== rowIndex);
		if (rows.length === 0) rows = [[createDefaultButton()]];
		expandedButton = null;
	}

	function updateButton(rowIndex, btnIndex, field, value) {
		rows = rows.map((row, ri) => {
			if (ri !== rowIndex) return row;
			return row.map((btn, bi) => {
				if (bi !== btnIndex) return btn;
				return { ...btn, [field]: value };
			});
		});
	}

	function toggleExpand(rowIndex, btnIndex) {
		const key = `${rowIndex}-${btnIndex}`;
		expandedButton = expandedButton === key ? null : key;
	}

	function isExpanded(rowIndex, btnIndex) {
		return expandedButton === `${rowIndex}-${btnIndex}`;
	}

	// Drag and drop for reordering within a row
	function handleDragStart(rowIndex, btnIndex, e) {
		dragState = { rowIndex, btnIndex };
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', ''); // Required for Firefox
	}

	function handleDragOver(rowIndex, btnIndex, e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
	}

	function handleDrop(rowIndex, btnIndex, e) {
		e.preventDefault();
		if (!dragState) return;

		const from = dragState;
		if (from.rowIndex === rowIndex && from.btnIndex === btnIndex) return;

		const newRows = rows.map((row) => [...row]);
		const [moved] = newRows[from.rowIndex].splice(from.btnIndex, 1);
		newRows[rowIndex].splice(btnIndex, 0, moved);

		// Clean empty rows
		rows = newRows.filter((row) => row.length > 0);
		if (rows.length === 0) rows = [[createDefaultButton()]];
		dragState = null;
	}

	function handleDragEnd() {
		dragState = null;
	}

	// Touch-based reordering
	let touchState = $state(null);

	function handleTouchStart(rowIndex, btnIndex, e) {
		const touch = e.touches[0];
		touchState = {
			rowIndex,
			btnIndex,
			startX: touch.clientX,
			startY: touch.clientY,
			moved: false,
		};
	}

	function handleTouchMove(e) {
		if (!touchState) return;
		const touch = e.touches[0];
		const dx = Math.abs(touch.clientX - touchState.startX);
		const dy = Math.abs(touch.clientY - touchState.startY);
		if (dx > 10 || dy > 10) {
			touchState.moved = true;
		}
	}

	function handleTouchEnd(_e) {
		if (!touchState) return;
		if (!touchState.moved) {
			// It was a tap, not a drag - toggle expand
			toggleExpand(touchState.rowIndex, touchState.btnIndex);
		}
		touchState = null;
	}
</script>

<!-- touch-drag reorder surface; keyboard interaction is not meaningful for the container -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="button-editor" ontouchmove={handleTouchMove} ontouchend={handleTouchEnd}>
	<div class="button-editor-header">
		<span class="section-label">Button Rows</span>
		<span class="section-hint">{rows.length}/5 rows</span>
	</div>

	<!-- Live Preview -->
	<div class="button-preview">
		<div class="preview-label">Preview</div>
		<div class="preview-message">
			{#each rows as row}
				<div class="preview-row">
					{#each row as btn}
						{@const styleInfo = getStyleInfo(btn.style)}
						<button
							type="button"
							class="preview-btn"
							style="background: {styleInfo.color}; color: {styleInfo.textColor};"
							disabled={btn.disabled}
						>
							{#if btn.emoji}<span class="preview-emoji">{btn.emoji}</span>{/if}
							{btn.label || 'Button'}
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- Row Editor -->
	{#each rows as row, rowIndex}
		<div class="button-row-editor">
			<div class="row-header">
				<span class="row-label">Row {rowIndex + 1}</span>
				<div class="row-controls">
					<span class="btn-count">{row.length}/5 buttons</span>
					{#if row.length < 5}
						<button
							type="button"
							class="btn-add-inline"
							onclick={() => addButton(rowIndex)}
							title="Add button"
						>
							+
						</button>
					{/if}
					{#if rows.length > 1}
						<button
							type="button"
							class="btn-remove-inline"
							onclick={() => removeRow(rowIndex)}
							title="Remove row"
						>
							×
						</button>
					{/if}
				</div>
			</div>

			<div class="button-list">
				{#each row as btn, btnIndex}
					{@const styleInfo = getStyleInfo(btn.style)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="button-item"
						class:expanded={isExpanded(rowIndex, btnIndex)}
						class:dragging={dragState?.rowIndex === rowIndex &&
							dragState?.btnIndex === btnIndex}
						draggable="true"
						ondragstart={(e) => handleDragStart(rowIndex, btnIndex, e)}
						ondragover={(e) => handleDragOver(rowIndex, btnIndex, e)}
						ondrop={(e) => handleDrop(rowIndex, btnIndex, e)}
						ondragend={handleDragEnd}
						ontouchstart={(e) => handleTouchStart(rowIndex, btnIndex, e)}
					>
						<!-- Button Summary Row (always visible) -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="button-summary"
							onclick={() => toggleExpand(rowIndex, btnIndex)}
						>
							<span class="drag-handle" title="Drag to reorder">⠿</span>
							<div
								class="button-chip"
								style="background: {styleInfo.color}; color: {styleInfo.textColor};"
							>
								{#if btn.emoji}<span>{btn.emoji}</span>{/if}
								{btn.label || 'Button'}
							</div>
							<span class="action-badge" title="{btn.actions?.length || 0} actions">
								⚡ {btn.actions?.length || 0}
							</span>
							<button
								type="button"
								class="btn-expand"
								title={isExpanded(rowIndex, btnIndex) ? 'Collapse' : 'Expand'}
							>
								{isExpanded(rowIndex, btnIndex) ? '▾' : '▸'}
							</button>
							<button
								type="button"
								class="btn-remove-btn"
								onclick={(e) => {
									e.stopPropagation();
									removeButton(rowIndex, btnIndex);
								}}
								title="Remove button"
							>
								×
							</button>
						</div>

						<!-- Expanded Configuration -->
						{#if isExpanded(rowIndex, btnIndex)}
							<div class="button-config">
								<div class="config-grid">
									<!-- svelte-ignore a11y_label_has_associated_control -->
									<div class="config-field">
										<label>Label</label>
										<input
											type="text"
											value={btn.label}
											oninput={(e) =>
												updateButton(
													rowIndex,
													btnIndex,
													'label',
													(e.target as HTMLInputElement).value
												)}
											placeholder="Button text"
											maxlength="80"
										/>
									</div>
									<!-- svelte-ignore a11y_label_has_associated_control -->
									<div class="config-field">
										<label>Style</label>
										<div class="style-picker">
											{#each BUTTON_STYLES as style}
												<button
													type="button"
													class="style-option"
													class:selected={btn.style === style.value}
													style="background: {style.color}; color: {style.textColor};"
													onclick={() =>
														updateButton(
															rowIndex,
															btnIndex,
															'style',
															style.value
														)}
													title={style.label}
												>
													{style.label}
												</button>
											{/each}
										</div>
									</div>
									<!-- svelte-ignore a11y_label_has_associated_control -->
									<div class="config-field">
										<label>Emoji <span class="optional">(optional)</span></label
										>
										<input
											type="text"
											value={btn.emoji}
											oninput={(e) =>
												updateButton(
													rowIndex,
													btnIndex,
													'emoji',
													(e.target as HTMLInputElement).value
												)}
											placeholder="👋 or leave empty"
											maxlength="32"
										/>
									</div>
									<!-- svelte-ignore a11y_label_has_associated_control -->
									<div class="config-field">
										<label>Button ID</label>
										<input
											type="text"
											value={btn.id}
											oninput={(e) =>
												updateButton(
													rowIndex,
													btnIndex,
													'id',
													(e.target as HTMLInputElement).value
												)}
											placeholder="unique_id"
											maxlength="32"
										/>
										<span class="field-hint"
											>Unique identifier for this button</span
										>
									</div>
									{#if btn.style === 5}
										<!-- svelte-ignore a11y_label_has_associated_control -->
										<div class="config-field full-width">
											<label>URL</label>
											<input
												type="url"
												value={btn.url || ''}
												oninput={(e) =>
													updateButton(
														rowIndex,
														btnIndex,
														'url',
														(e.target as HTMLInputElement).value
													)}
												placeholder="https://example.com"
											/>
											<span class="field-hint"
												>Link buttons open a URL instead of triggering
												actions</span
											>
										</div>
									{/if}
									<div class="config-field">
										<label class="checkbox-label">
											<input
												type="checkbox"
												checked={btn.disabled || false}
												onchange={(e) =>
													updateButton(
														rowIndex,
														btnIndex,
														'disabled',
														(e.target as HTMLInputElement).checked
													)}
											/>
											<span>Disabled</span>
										</label>
									</div>
								</div>

								<!-- Button Actions (only for non-link buttons) -->
								{#if btn.style !== 5}
									<div class="button-actions-section">
										<h4>⚡ Click Actions</h4>
										<p class="section-hint">
											Actions to execute when this button is clicked
										</p>
										<ActionFlowBuilder
											bind:actions={btn.actions}
											{actionTypes}
											{templateVariables}
											{channels}
											{roles}
											{guildId}
											{userSources}
											compact={true}
										/>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/each}

	{#if rows.length < 5}
		<button type="button" class="btn-add-row" onclick={addRow}> + Add Row </button>
	{/if}
</div>

<style>
	.button-editor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.button-editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-label {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.section-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Preview — always use Discord's dark chat background so button colors render correctly */
	.button-preview {
		background: var(--color-fixed-surface-discord-alt);
		border: 1px solid var(--color-fixed-border-subtle);
		border-radius: 0.5rem;
		padding: 0.75rem;
	}

	.preview-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #b5bac1;
		margin-bottom: 0.5rem;
	}

	.preview-message {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.preview-row {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.preview-btn {
		padding: 0.35rem 0.75rem;
		border: none;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: default;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		transition: opacity 0.15s;
		line-height: 1.3;
	}

	.preview-btn:disabled {
		opacity: 0.5;
	}

	.preview-emoji {
		font-size: 0.9rem;
	}

	/* Row Editor */
	.button-row-editor {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.row-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-elevated);
		border-bottom: 1px solid var(--color-border-light);
	}

	.row-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.row-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.btn-count {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.btn-add-inline,
	.btn-remove-inline {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		border: none;
		font-size: 0.85rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}

	.btn-add-inline {
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	.btn-add-inline:hover {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.btn-remove-inline {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.btn-remove-inline:hover {
		background: var(--color-danger);
		color: white;
	}

	/* Button List */
	.button-list {
		display: flex;
		flex-direction: column;
	}

	.button-item {
		border-bottom: 1px solid var(--color-border-light);
		transition: background 0.15s;
	}

	.button-item:last-child {
		border-bottom: none;
	}

	.button-item.dragging {
		opacity: 0.5;
	}

	.button-item.expanded {
		background: var(--color-surface);
	}

	/* Summary row */
	.button-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		user-select: none;
	}

	.button-summary:hover {
		background: var(--color-surface-hover);
	}

	.drag-handle {
		cursor: grab;
		color: var(--color-text-light);
		font-size: 0.85rem;
		padding: 0.2rem;
		user-select: none;
		touch-action: none;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.button-chip {
		padding: 0.25rem 0.6rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.action-badge {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-left: auto;
	}

	.btn-expand,
	.btn-remove-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding: 0.2rem 0.35rem;
		border-radius: 0.2rem;
		transition: all 0.15s;
	}

	.btn-expand:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.btn-remove-btn:hover {
		color: var(--color-danger);
		background: var(--color-danger-soft);
	}

	/* Config Panel */
	.button-config {
		padding: 0.75rem;
		border-top: 1px solid var(--color-border-light);
		background: var(--color-surface);
	}

	.config-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	@media (max-width: 600px) {
		.config-grid {
			grid-template-columns: 1fr;
		}
	}

	.config-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.config-field.full-width {
		grid-column: 1 / -1;
	}

	.config-field label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.config-field .optional {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.config-field input[type='text'],
	.config-field input[type='url'] {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 0.35rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.config-field input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary-soft);
	}

	.field-hint {
		font-size: 0.65rem;
		color: var(--color-text-muted);
	}

	/* Style Picker */
	.style-picker {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.style-option {
		padding: 0.2rem 0.5rem;
		border: 2px solid transparent;
		border-radius: 0.25rem;
		font-size: 0.7rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.style-option.selected {
		border-color: var(--color-text);
		box-shadow: 0 0 0 1px var(--color-text);
	}

	.style-option:hover {
		transform: scale(1.05);
	}

	/* Checkbox */
	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		cursor: pointer;
	}

	/* Button Actions Section */
	.button-actions-section {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border-light);
	}

	.button-actions-section h4 {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
	}

	.button-actions-section .section-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
		display: block;
	}

	/* Add Row Button */
	.btn-add-row {
		display: block;
		width: 100%;
		padding: 0.5rem;
		border: 2px dashed var(--color-border);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-add-row:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: var(--color-primary-soft);
	}
</style>
