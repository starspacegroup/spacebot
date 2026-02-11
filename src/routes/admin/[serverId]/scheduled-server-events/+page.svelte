<script>
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	
	let { data, form } = $props();
	
	let showToast = $state(true);
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let showEditChoiceModal = $state(false);
	let editingEvent = $state(null);
	let deleteConfirmId = $state(null);
	let processing = $state(false);
	
	// Create form state
	let createName = $state('');
	let createDescription = $state('');
	let createEntityType = $state(3); // External by default
	let createChannelId = $state('');
	let createLocation = $state('');
	let createStartTime = $state('');
	let createEndTime = $state('');
	
	// Recurrence state
	let createIsRecurring = $state(false);
	let createRecurrenceFrequency = $state(2); // Weekly by default
	let createRecurrenceInterval = $state(1);
	let createRecurrenceWeekdays = $state([]); // Array of day indices 0-6 (Mon-Sun)
	let createRecurrenceCount = $state(null);
	
	// Image state
	let createImagePreview = $state(null);
	let createImageData = $state(null);
	let editImagePreview = $state(null);
	let editImageData = $state(null);
	let editRemoveImage = $state(false);
	
	// Edit form state
	let editName = $state('');
	let editDescription = $state('');
	let editEntityType = $state(3);
	let editChannelId = $state('');
	let editLocation = $state('');
	let editStartTime = $state('');
	let editEndTime = $state('');
	
	// Edit recurrence state
	let editIsRecurring = $state(false);
	let editRecurrenceFrequency = $state(2);
	let editRecurrenceInterval = $state(1);
	let editRecurrenceWeekdays = $state([]);
	let editRecurrenceCount = $state(null);
	
	// Track if editing full series for recurring events
	let editFullSeries = $state(true);
	
	function resetCreateForm() {
		createName = '';
		createDescription = '';
		createEntityType = 3;
		createChannelId = '';
		createLocation = '';
		createStartTime = '';
		createEndTime = '';
		createIsRecurring = false;
		createRecurrenceFrequency = 2;
		createRecurrenceInterval = 1;
		createRecurrenceWeekdays = [];
		createRecurrenceCount = null;
		createImagePreview = null;
		createImageData = null;
	}
	
	/**
	 * Handle image file selection and convert to base64 data URI
	 */
	function handleImageSelect(event, isEdit = false) {
		const file = event.target.files?.[0];
		if (!file) return;
		
		// Validate file type
		if (!file.type.match(/^image\/(png|jpeg|gif|webp)$/)) {
			alert('Please select a valid image file (PNG, JPEG, GIF, or WebP)');
			return;
		}
		
		// Validate file size (max 10MB for Discord)
		if (file.size > 10 * 1024 * 1024) {
			alert('Image must be smaller than 10MB');
			return;
		}
		
		const reader = new FileReader();
		reader.onload = (e) => {
			const dataUri = e.target.result;
			if (isEdit) {
				editImagePreview = dataUri;
				editImageData = dataUri;
				editRemoveImage = false;
			} else {
				createImagePreview = dataUri;
				createImageData = dataUri;
			}
		};
		reader.readAsDataURL(file);
	}
	
	function clearCreateImage() {
		createImagePreview = null;
		createImageData = null;
	}
	
	function clearEditImage() {
		editImagePreview = null;
		editImageData = null;
		editRemoveImage = true;
	}
	
	function toggleWeekday(dayIndex) {
		if (createRecurrenceWeekdays.includes(dayIndex)) {
			createRecurrenceWeekdays = createRecurrenceWeekdays.filter(d => d !== dayIndex);
		} else {
			createRecurrenceWeekdays = [...createRecurrenceWeekdays, dayIndex].sort((a, b) => a - b);
		}
	}
	
	function getWeekdayShort(index) {
		return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index];
	}
	
	function toggleEditWeekday(dayIndex) {
		if (editRecurrenceWeekdays.includes(dayIndex)) {
			editRecurrenceWeekdays = editRecurrenceWeekdays.filter(d => d !== dayIndex);
		} else {
			editRecurrenceWeekdays = [...editRecurrenceWeekdays, dayIndex].sort((a, b) => a - b);
		}
	}
	
	/**
	 * Handle clicking edit on an event - shows choice modal for recurring events
	 */
	function handleEditClick(event) {
		editingEvent = event;
		
		// If it's a recurring event, show the choice modal first
		if (event.recurrenceRule) {
			showEditChoiceModal = true;
		} else {
			// Non-recurring event, go straight to edit modal
			initializeEditForm(event, false);
			showEditModal = true;
		}
	}
	
	/**
	 * User chose to edit just the next occurrence
	 */
	function editNextOccurrence() {
		showEditChoiceModal = false;
		initializeEditForm(editingEvent, false);
		showEditModal = true;
	}
	
	/**
	 * User chose to edit the entire series
	 */
	function editEntireSeries() {
		showEditChoiceModal = false;
		initializeEditForm(editingEvent, true);
		showEditModal = true;
	}
	
	/**
	 * Convert a Date to local datetime-local input format (YYYY-MM-DDTHH:mm)
	 */
	function toLocalDateTimeString(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}
	
	/**
	 * Initialize the edit form with event data
	 */
	function initializeEditForm(event, isFullSeries) {
		editName = event.name;
		editDescription = event.description || '';
		editEntityType = event.entityType;
		editChannelId = event.channelId || '';
		editLocation = event.location || '';
		// Convert ISO to local datetime format
		editStartTime = event.scheduledStartTime ? toLocalDateTimeString(new Date(event.scheduledStartTime)) : '';
		editEndTime = event.scheduledEndTime ? toLocalDateTimeString(new Date(event.scheduledEndTime)) : '';
		
		// Initialize image state
		editImagePreview = event.image || null;
		editImageData = null; // Only set when user uploads a new image
		editRemoveImage = false;
		
		// Set edit mode
		editFullSeries = isFullSeries;
		
		// Initialize recurrence state from existing event
		if (event.recurrenceRule) {
			editIsRecurring = true;
			editRecurrenceFrequency = event.recurrenceRule.frequency;
			editRecurrenceInterval = event.recurrenceRule.interval || 1;
			// Convert weekday names back to indices
			const weekdayNameToIndex = { 'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6 };
			editRecurrenceWeekdays = event.recurrenceRule.byWeekday?.map(name => weekdayNameToIndex[name]) || [];
			editRecurrenceCount = event.recurrenceRule.count || null;
		} else {
			editIsRecurring = false;
			editRecurrenceFrequency = 2;
			editRecurrenceInterval = 1;
			editRecurrenceWeekdays = [];
			editRecurrenceCount = null;
		}
	}
	
	function getChannelName(channelId) {
		const channel = data.voiceChannels.find(c => c.id === channelId);
		return channel ? channel.name : 'Unknown Channel';
	}
	
	function closeEditModal() {
		showEditModal = false;
		showEditChoiceModal = false;
		editingEvent = null;
	}
	
	function formatDateTime(isoString) {
		if (!isoString) return 'Not set';
		const date = new Date(isoString);
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
		});
	}
	
	function formatRelativeTime(isoString) {
		if (!isoString) return '';
		const date = new Date(isoString);
		const now = new Date();
		const diffMs = date - now;
		const diffMins = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
		
		if (diffMs < 0) {
			// In the past
			const absDays = Math.abs(diffDays);
			if (absDays === 0) return 'Today';
			if (absDays === 1) return 'Yesterday';
			return `${absDays} days ago`;
		}
		
		if (diffMins < 60) return `in ${diffMins}m`;
		if (diffHours < 24) return `in ${diffHours}h`;
		if (diffDays === 1) return 'Tomorrow';
		return `in ${diffDays} days`;
	}
	
	function getStatusBadgeClass(status) {
		switch (status) {
			case 1: return 'status-scheduled';
			case 2: return 'status-active';
			case 3: return 'status-completed';
			case 4: return 'status-canceled';
			default: return '';
		}
	}
	
	function canStartEvent(event) {
		// Can only start scheduled events
		return event.status === 1;
	}
	
	function canEndEvent(event) {
		// Can only end active events
		return event.status === 2;
	}
	
	function canCancelEvent(event) {
		// Can cancel scheduled events (not yet started)
		return event.status === 1;
	}
	
	function canEditEvent(event) {
		// Can edit scheduled or active events
		return event.status === 1 || event.status === 2;
	}
	
	function canDeleteEvent(event) {
		// Can delete any non-completed event
		return event.status !== 3;
	}
</script>

<svelte:head>
	<title>Scheduled Events | {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="events-page">
	{#if (form?.message || form?.error) && showToast}
		<Toast 
			message={form.message || form.error} 
			success={form?.success} 
			onDismiss={() => showToast = false} 
		/>
	{/if}
	
	<a href="/admin/{data.serverId}" class="back-link">← Back to Dashboard</a>
	
	<header class="page-header">
		<div class="header-content">
			<h1>
				<span class="header-icon">📅</span>
				Scheduled Events
			</h1>
			<p class="header-subtitle">Manage your server's scheduled events and activities</p>
		</div>
		<div class="header-actions">
			<button class="btn btn-primary" onclick={() => showCreateModal = true}>
				<span>➕</span>
				Create Event
			</button>
		</div>
	</header>
	
	{#if data.events.length === 0}
		<div class="empty-state">
			<div class="empty-icon">📅</div>
			<h2>No Scheduled Events</h2>
			<p>Create your first event to get your community together!</p>
			<button class="btn btn-primary" onclick={() => showCreateModal = true}>
				<span>➕</span>
				Create Event
			</button>
		</div>
	{:else}
		<div class="events-grid">
			{#each data.events as event (event.id)}
				<div class="event-card" class:event-active={event.status === 2}>
					{#if event.image}
						<div class="event-image">
							<img src={event.image} alt={event.name} />
						</div>
					{/if}
					
					<div class="event-content">
						<div class="event-header">
							<div class="event-meta">
								<span class="status-badge {getStatusBadgeClass(event.status)}">
									{event.statusInfo.name}
								</span>
								<span class="entity-type" title={event.entityTypeInfo.name}>
									{event.entityTypeInfo.icon}
								</span>
							</div>
							<h3 class="event-title">{event.name}</h3>
						</div>
						
						{#if event.description}
							<p class="event-description">{event.description}</p>
						{/if}
						
						<div class="event-details">
							<div class="detail-row">
								<span class="detail-icon">🕐</span>
								<div class="detail-content">
									<span class="detail-label">Starts</span>
									<span class="detail-value">{formatDateTime(event.scheduledStartTime)}</span>
									<span class="detail-relative">{formatRelativeTime(event.scheduledStartTime)}</span>
								</div>
							</div>
							
							{#if event.scheduledEndTime}
								<div class="detail-row">
									<span class="detail-icon">🏁</span>
									<div class="detail-content">
										<span class="detail-label">Ends</span>
										<span class="detail-value">{formatDateTime(event.scheduledEndTime)}</span>
									</div>
								</div>
							{/if}
							
							{#if event.location}
								<div class="detail-row">
									<span class="detail-icon">📍</span>
									<div class="detail-content">
										<span class="detail-label">Location</span>
										<span class="detail-value location-value">{event.location}</span>
									</div>
								</div>
							{:else if event.channelId}
								<div class="detail-row">
									<span class="detail-icon">{event.entityType === 1 ? '🎭' : '🔊'}</span>
									<div class="detail-content">
										<span class="detail-label">Channel</span>
										<span class="detail-value">{getChannelName(event.channelId)}</span>
									</div>
								</div>
							{/if}
							
							{#if event.recurrenceRule}
								<div class="detail-row">
									<span class="detail-icon">🔄</span>
									<div class="detail-content">
										<span class="detail-label">Repeats</span>
										<span class="detail-value">
											{event.recurrenceRule.frequencyName}
											{#if event.recurrenceRule.byWeekday.length > 0}
												on {event.recurrenceRule.byWeekday.join(', ')}
											{/if}
										</span>
									</div>
								</div>
							{/if}
							
							<div class="detail-row">
								<span class="detail-icon">👥</span>
								<div class="detail-content">
									<span class="detail-label">Interested</span>
									<span class="detail-value">{event.userCount} member{event.userCount !== 1 ? 's' : ''}</span>
								</div>
							</div>
						</div>
						
						<div class="event-actions">
							{#if canStartEvent(event)}
								<form method="POST" action="?/start" use:enhance={() => {
									processing = true;
									return async ({ update }) => {
										await update();
										processing = false;
										showToast = true;
									};
								}}>
									<input type="hidden" name="eventId" value={event.id} />
									<button type="submit" class="btn btn-sm btn-success" disabled={processing}>
										▶️ Start
									</button>
								</form>
							{/if}
							
							{#if canEndEvent(event)}
								<form method="POST" action="?/end" use:enhance={() => {
									processing = true;
									return async ({ update }) => {
										await update();
										processing = false;
										showToast = true;
									};
								}}>
									<input type="hidden" name="eventId" value={event.id} />
									<button type="submit" class="btn btn-sm btn-warning" disabled={processing}>
										⏹️ End
									</button>
								</form>
							{/if}
							
							{#if canCancelEvent(event)}
								<form method="POST" action="?/cancel" use:enhance={() => {
									processing = true;
									return async ({ update }) => {
										await update();
										processing = false;
										showToast = true;
									};
								}}>
									<input type="hidden" name="eventId" value={event.id} />
									<button type="submit" class="btn btn-sm btn-danger-outline" disabled={processing}>
										🚫 Cancel
									</button>
								</form>
							{/if}
							
							{#if canEditEvent(event)}
								<button class="btn btn-sm btn-secondary" onclick={() => handleEditClick(event)}>
									✏️ Edit
								</button>
							{/if}
							
							{#if canDeleteEvent(event)}
								{#if deleteConfirmId === event.id}
									<form method="POST" action="?/delete" use:enhance={() => {
										processing = true;
										return async ({ update }) => {
											await update();
											processing = false;
											deleteConfirmId = null;
											showToast = true;
										};
									}}>
										<input type="hidden" name="eventId" value={event.id} />
										<button type="submit" class="btn btn-sm btn-danger" disabled={processing}>
											Confirm
										</button>
									</form>
									<button class="btn btn-sm btn-secondary" onclick={() => deleteConfirmId = null}>
										Cancel
									</button>
								{:else}
									<button class="btn btn-sm btn-danger-outline" onclick={() => deleteConfirmId = event.id}>
										🗑️ Delete
									</button>
								{/if}
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	
	<!-- Create Event Modal -->
	{#if showCreateModal}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal-overlay" role="presentation" onclick={() => showCreateModal = false}>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby="create-modal-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<h2 id="create-modal-title">Create Scheduled Event</h2>
					<button class="modal-close" onclick={() => showCreateModal = false}>×</button>
				</div>
				
				<form method="POST" action="?/create" use:enhance={() => {
					processing = true;
					return async ({ update, result }) => {
						await update();
						processing = false;
						showToast = true;
						if (result.type === 'success') {
							showCreateModal = false;
							resetCreateForm();
						}
					};
				}}>
					<div class="modal-body">
						<!-- Cover Image Upload -->
						<div class="form-group">
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<label>Cover Image</label>
							<div class="image-upload-area">
								{#if createImagePreview}
									<div class="image-preview">
										<img src={createImagePreview} alt="Event cover preview" />
										<button type="button" class="image-remove-btn" onclick={clearCreateImage} aria-label="Remove image">
											×
										</button>
									</div>
								{:else}
									<label class="image-upload-label" for="create-image">
										<span class="upload-icon">🖼️</span>
										<span class="upload-text">Click to upload cover image</span>
										<span class="upload-hint">PNG, JPEG, GIF, or WebP (max 10MB)</span>
									</label>
								{/if}
								<input 
									type="file" 
									id="create-image" 
									accept="image/png,image/jpeg,image/gif,image/webp"
									onchange={(e) => handleImageSelect(e, false)}
									class="image-input"
								/>
								<input type="hidden" name="image" value={createImageData || ''} />
							</div>
						</div>
						
						<div class="form-group">
							<label for="create-name">Event Name *</label>
							<input 
								type="text" 
								id="create-name" 
								name="name" 
								bind:value={createName}
								placeholder="Weekly Game Night"
								required 
							/>
						</div>
						
						<div class="form-group">
							<label for="create-description">Description</label>
							<textarea 
								id="create-description" 
								name="description" 
								bind:value={createDescription}
								placeholder="Join us for fun and games!"
								rows="3"
							></textarea>
						</div>
						
						<div class="form-group">
							<label for="create-entity-type">Event Type</label>
							<select id="create-entity-type" name="entityType" bind:value={createEntityType}>
								<option value={3}>📍 External (URL or Location)</option>
								<option value={2}>🔊 Voice Channel</option>
								<option value={1}>🎭 Stage Channel</option>
							</select>
						</div>
						
						{#if createEntityType === 3}
							<div class="form-group">
								<label for="create-location">Location / URL *</label>
								<input 
									type="text" 
									id="create-location" 
									name="location" 
									bind:value={createLocation}
									placeholder="https://example.com or a physical address"
									required 
								/>
								<span class="form-hint">This can be a URL, address, or any location description</span>
							</div>
						{:else}
							<div class="form-group">
								<label for="create-channel">
									{createEntityType === 1 ? 'Stage' : 'Voice'} Channel *
								</label>
								<select id="create-channel" name="channelId" bind:value={createChannelId} required>
									<option value="">Select a channel</option>
									{#each data.voiceChannels.filter(c => 
										createEntityType === 1 ? c.type === 'stage' : c.type === 'voice'
									) as channel}
										<option value={channel.id}>
											{channel.type === 'stage' ? '🎭' : '🔊'} {channel.name}
										</option>
									{/each}
								</select>
							</div>
						{/if}
						
						<div class="form-row">
							<div class="form-group">
								<label for="create-start">Start Time *</label>
								<input 
									type="datetime-local" 
									id="create-start" 
									name="scheduledStartTime" 
									bind:value={createStartTime}
									required 
								/>
							</div>
							
							<div class="form-group">
								<label for="create-end">End Time {createEntityType === 3 ? '*' : ''}</label>
								<input 
									type="datetime-local" 
									id="create-end" 
									name="scheduledEndTime" 
									bind:value={createEndTime}
									required={createEntityType === 3}
								/>
							</div>
						</div>
						
						<!-- Recurrence Options -->
						<div class="form-group recurrence-toggle">
							<label class="toggle-label">
								<input 
									type="checkbox" 
									bind:checked={createIsRecurring}
									name="isRecurring"
								/>
								<span class="toggle-switch"></span>
								<span class="toggle-text">🔄 Make this a recurring event</span>
							</label>
						</div>
						
						{#if createIsRecurring}
							<input type="hidden" name="recurrenceEnabled" value="true" />
							<div class="recurrence-options">
								<div class="form-row">
									<div class="form-group">
										<label for="create-frequency">Repeat</label>
										<select 
											id="create-frequency" 
											name="recurrenceFrequency" 
											bind:value={createRecurrenceFrequency}
										>
											<option value={3}>Daily</option>
											<option value={2}>Weekly</option>
											<option value={1}>Monthly</option>
											<option value={0}>Yearly</option>
										</select>
									</div>
									
									<div class="form-group">
										<label for="create-interval">Every</label>
										<div class="interval-input">
											<input 
												type="number" 
												id="create-interval" 
												name="recurrenceInterval"
												bind:value={createRecurrenceInterval}
												min="1" 
												max="100"
											/>
											<span class="interval-label">
												{createRecurrenceFrequency === 3 ? 'day(s)' : 
												 createRecurrenceFrequency === 2 ? 'week(s)' : 
												 createRecurrenceFrequency === 1 ? 'month(s)' : 'year(s)'}
											</span>
										</div>
									</div>
								</div>
								
								{#if createRecurrenceFrequency === 2}
									<div class="form-group">
										<!-- svelte-ignore a11y_label_has_associated_control -->
										<label>On days</label>
										<div class="weekday-picker" role="group" aria-label="Select days of the week">
											{#each [0, 1, 2, 3, 4, 5, 6] as dayIndex}
												<button 
													type="button"
													class="weekday-btn"
													class:selected={createRecurrenceWeekdays.includes(dayIndex)}
													onclick={() => toggleWeekday(dayIndex)}
													aria-pressed={createRecurrenceWeekdays.includes(dayIndex)}
												>
													{getWeekdayShort(dayIndex)}
												</button>
											{/each}
										</div>
										<input type="hidden" name="recurrenceWeekdays" value={createRecurrenceWeekdays.join(',')} />
									</div>
								{/if}
								
								<div class="form-group">
									<label for="create-count">End after (optional)</label>
									<div class="interval-input">
										<input 
											type="number" 
											id="create-count" 
											name="recurrenceCount"
											bind:value={createRecurrenceCount}
											min="1" 
											max="100"
											placeholder="∞"
										/>
										<span class="interval-label">occurrence(s)</span>
									</div>
									<span class="form-hint">Leave blank for indefinite recurrence</span>
								</div>
							</div>
						{/if}
					</div>
					
					<div class="modal-footer">
						<button type="button" class="btn btn-secondary" onclick={() => showCreateModal = false}>
							Cancel
						</button>
						<button type="submit" class="btn btn-primary" disabled={processing}>
							{processing ? 'Creating...' : 'Create Event'}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
	
	<!-- Edit Choice Modal (for recurring events) -->
	{#if showEditChoiceModal && editingEvent}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal-overlay" role="presentation" onclick={() => showEditChoiceModal = false}>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="modal modal-choice" role="dialog" aria-modal="true" aria-labelledby="edit-choice-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<h2 id="edit-choice-title">Edit Recurring Event</h2>
					<button class="modal-close" onclick={() => showEditChoiceModal = false} aria-label="Close">×</button>
				</div>
				
				<div class="modal-body choice-body">
					<p class="choice-description">
						This is a recurring event. What would you like to edit?
					</p>
					
					<div class="choice-options">
						<button class="choice-card" onclick={editNextOccurrence}>
							<span class="choice-icon">📅</span>
							<div class="choice-content">
								<div class="choice-title">Edit Next Occurrence</div>
								<div class="choice-subtitle">Only change the time for the upcoming event</div>
							</div>
						</button>
						
						<button class="choice-card choice-card-primary" onclick={editEntireSeries}>
							<span class="choice-icon">🔄</span>
							<div class="choice-content">
								<div class="choice-title">Edit Entire Series</div>
								<div class="choice-subtitle">Change name, description, channel, image, and recurrence settings</div>
							</div>
						</button>
					</div>
				</div>
				
				<div class="modal-footer">
					<button type="button" class="btn btn-secondary" onclick={() => showEditChoiceModal = false}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}
	
	<!-- Edit Event Modal -->
	{#if showEditModal && editingEvent}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal-overlay" role="presentation" onclick={closeEditModal}>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<div class="modal-header-content">
						<h2 id="edit-modal-title">
							{#if editingEvent.recurrenceRule}
								{editFullSeries ? 'Edit Entire Series' : 'Edit Next Occurrence'}
							{:else}
								Edit Event
							{/if}
						</h2>
						{#if editingEvent.recurrenceRule}
							<span class="modal-badge">{editFullSeries ? '🔄 Series' : '📅 Single'}</span>
						{/if}
					</div>
					<button class="modal-close" onclick={closeEditModal} aria-label="Close modal">×</button>
				</div>
				
				<form method="POST" action="?/update" use:enhance={() => {
					processing = true;
					return async ({ update, result }) => {
						await update();
						processing = false;
						showToast = true;
						if (result.type === 'success') {
							closeEditModal();
						}
					};
				}}>
					<input type="hidden" name="eventId" value={editingEvent.id} />
					<input type="hidden" name="editFullSeries" value={editFullSeries ? 'true' : ''} />
					
					<div class="modal-body">
						{#if editFullSeries || !editingEvent.recurrenceRule}
							<!-- Cover Image Section - For full series edit or non-recurring events -->
							<div class="form-section">
								<h3 class="form-section-title">🖼️ Cover Image</h3>
								<div class="image-upload-area">
									{#if editImagePreview}
										<div class="image-preview">
											<img src={editImagePreview} alt="Event cover preview" />
											<button type="button" class="image-remove-btn" onclick={clearEditImage} aria-label="Remove image">
												×
											</button>
										</div>
										<label class="image-change-btn" for="edit-image">
											Change Image
										</label>
									{:else}
										<label class="image-upload-label" for="edit-image">
											<span class="upload-icon">🖼️</span>
											<span class="upload-text">Click to upload cover image</span>
											<span class="upload-hint">PNG, JPEG, GIF, or WebP (max 10MB)</span>
										</label>
									{/if}
									<input 
										type="file" 
										id="edit-image" 
										accept="image/png,image/jpeg,image/gif,image/webp"
										onchange={(e) => handleImageSelect(e, true)}
										class="image-input"
									/>
									<input type="hidden" name="image" value={editImageData || ''} />
									<input type="hidden" name="removeImage" value={editRemoveImage ? 'true' : ''} />
								</div>
							</div>
							
							<!-- Event Type Section - For full series edit or non-recurring events -->
							<div class="form-section">
								<h3 class="form-section-title">🎯 Event Type</h3>
								<div class="form-group">
									<label for="edit-entity-type">Event Type</label>
									<select id="edit-entity-type" name="entityType" bind:value={editEntityType}>
										<option value={3}>📍 External (URL or Location)</option>
										<option value={2}>🔊 Voice Channel</option>
										<option value={1}>🎭 Stage Channel</option>
									</select>
								</div>
							</div>
							
							<!-- Basic Info Section - For full series edit or non-recurring events -->
							<div class="form-section">
								<h3 class="form-section-title">Basic Info</h3>
								
								<div class="form-group">
									<label for="edit-name">Event Name *</label>
									<input 
										type="text" 
										id="edit-name" 
										name="name" 
										bind:value={editName}
										required 
									/>
								</div>
								
								<div class="form-group">
									<label for="edit-description">Description</label>
									<textarea 
										id="edit-description" 
										name="description" 
										bind:value={editDescription}
										rows="3"
										placeholder="Describe your event..."
									></textarea>
								</div>
							</div>
							
							<!-- Location / Channel Section - For full series edit or non-recurring events -->
							<div class="form-section">
								<h3 class="form-section-title">
									{editEntityType === 3 ? '📍 Location' : '🔊 Channel'}
								</h3>
								
								{#if editEntityType === 3}
									<div class="form-group">
										<label for="edit-location">Location or URL</label>
										<input 
											type="text" 
											id="edit-location" 
											name="location" 
											bind:value={editLocation}
											placeholder="https://example.com or a physical address"
										/>
										<span class="form-hint">A link, address, or any location description</span>
									</div>
								{:else}
									<div class="form-group">
										<label for="edit-channel">
											{editEntityType === 1 ? 'Stage' : 'Voice'} Channel
										</label>
										<select id="edit-channel" name="channelId" bind:value={editChannelId}>
											{#each data.voiceChannels.filter(c => 
												editEntityType === 1 ? c.type === 'stage' : c.type === 'voice'
											) as channel}
												<option value={channel.id}>
													{channel.type === 'stage' ? '🎭' : '🔊'} {channel.name}
												</option>
											{/each}
										</select>
										<span class="form-hint">Select a different channel to move the event</span>
									</div>
								{/if}
							</div>
						{:else}
							<!-- Single Occurrence Edit Info (recurring events only) -->
							<input type="hidden" name="entityType" value={editEntityType} />
							<div class="occurrence-info">
								<div class="occurrence-header">
									<span class="occurrence-icon">📅</span>
									<div class="occurrence-details">
										<span class="occurrence-title">{editingEvent.name}</span>
										<span class="occurrence-subtitle">Editing only the next scheduled occurrence</span>
									</div>
								</div>
							</div>
						{/if}
						
						<!-- Time Section - Always shown -->
						<div class="form-section">
							<h3 class="form-section-title">🕐 Schedule</h3>
							
							{#if !editFullSeries && editingEvent.recurrenceRule}
								<p class="section-hint">Change the time for just this occurrence</p>
							{/if}
							
							<div class="form-row">
								<div class="form-group">
									<label for="edit-start">Start Time</label>
									<input 
										type="datetime-local" 
										id="edit-start" 
										name="scheduledStartTime" 
										bind:value={editStartTime}
									/>
								</div>
								
								<div class="form-group">
									<label for="edit-end">End Time</label>
									<input 
										type="datetime-local" 
										id="edit-end" 
										name="scheduledEndTime" 
										bind:value={editEndTime}
									/>
								</div>
							</div>
						</div>
						
						<!-- Recurrence Section - Only for full series edit -->
						{#if editFullSeries}
							<div class="form-section recurrence-section">
								<div class="form-group recurrence-toggle">
									<label class="toggle-label">
										<input 
											type="checkbox" 
											bind:checked={editIsRecurring}
											name="editIsRecurring"
										/>
										<span class="toggle-switch"></span>
										<span class="toggle-text">🔄 Recurring Event</span>
									</label>
								</div>
								
								{#if editIsRecurring}
									<input type="hidden" name="recurrenceEnabled" value="true" />
									<div class="recurrence-options">
										<div class="form-row">
											<div class="form-group">
												<label for="edit-frequency">Repeat</label>
												<select 
													id="edit-frequency" 
													name="recurrenceFrequency" 
													bind:value={editRecurrenceFrequency}
												>
													<option value={3}>Daily</option>
													<option value={2}>Weekly</option>
													<option value={1}>Monthly</option>
													<option value={0}>Yearly</option>
												</select>
											</div>
											
											<div class="form-group">
												<label for="edit-interval">Every</label>
												<div class="interval-input">
													<input 
														type="number" 
														id="edit-interval" 
														name="recurrenceInterval"
														bind:value={editRecurrenceInterval}
														min="1" 
														max="100"
													/>
													<span class="interval-label">
														{editRecurrenceFrequency === 3 ? 'day(s)' : 
														 editRecurrenceFrequency === 2 ? 'week(s)' : 
														 editRecurrenceFrequency === 1 ? 'month(s)' : 'year(s)'}
													</span>
												</div>
											</div>
										</div>
										
										{#if editRecurrenceFrequency === 2}
											<div class="form-group">
												<!-- svelte-ignore a11y_label_has_associated_control -->
												<label>On days</label>
												<div class="weekday-picker" role="group" aria-label="Select days of the week">
													{#each [0, 1, 2, 3, 4, 5, 6] as dayIndex}
														<button 
															type="button"
															class="weekday-btn"
															class:selected={editRecurrenceWeekdays.includes(dayIndex)}
															onclick={() => toggleEditWeekday(dayIndex)}
															aria-pressed={editRecurrenceWeekdays.includes(dayIndex)}
														>
															{getWeekdayShort(dayIndex)}
														</button>
													{/each}
												</div>
												<input type="hidden" name="recurrenceWeekdays" value={editRecurrenceWeekdays.join(',')} />
											</div>
										{/if}
										
										<div class="form-group">
											<label for="edit-count">End after (optional)</label>
											<div class="interval-input">
												<input 
													type="number" 
													id="edit-count" 
													name="recurrenceCount"
													bind:value={editRecurrenceCount}
													min="1" 
													max="100"
													placeholder="∞"
												/>
												<span class="interval-label">occurrence(s)</span>
											</div>
											<span class="form-hint">Leave blank for indefinite recurrence</span>
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>
					
					<div class="modal-footer">
						<button type="button" class="btn btn-secondary" onclick={closeEditModal}>
							Cancel
						</button>
						<button type="submit" class="btn btn-primary" disabled={processing}>
							{processing ? 'Saving...' : 'Save Changes'}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Mobile-first base styles */
	.events-page {
		width: 100%;
		margin: 0 auto;
		padding: 0.75rem;
		min-height: 100vh;
		box-sizing: border-box;
	}
	
	@media (min-width: 480px) {
		.events-page {
			padding: 1rem;
		}
	}
	
	@media (min-width: 640px) {
		.events-page {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.events-page {
			padding: 2rem 3rem;
		}
	}
	
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
		padding: 0.5rem 0;
		transition: color 0.2s;
		-webkit-tap-highlight-color: transparent;
	}
	
	.back-link:hover,
	.back-link:active {
		color: var(--color-primary);
	}
	
	.page-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.page-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
			gap: 1rem;
			margin-bottom: 2rem;
		}
	}
	
	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	
	@media (min-width: 640px) {
		.header-content h1 {
			font-size: 1.75rem;
		}
	}
	
	.header-icon {
		font-size: 1.25rem;
	}
	
	@media (min-width: 640px) {
		.header-icon {
			font-size: 1.5rem;
		}
	}
	
	.header-subtitle {
		color: var(--color-text-secondary);
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
	}
	
	@media (min-width: 640px) {
		.header-subtitle {
			font-size: 0.9rem;
		}
	}
	
	.header-actions {
		display: flex;
		gap: 0.5rem;
		width: 100%;
	}
	
	.header-actions .btn {
		flex: 1;
		justify-content: center;
	}
	
	@media (min-width: 640px) {
		.header-actions {
			width: auto;
		}
		
		.header-actions .btn {
			flex: none;
		}
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 2.5rem 1.5rem;
		background: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	@media (min-width: 640px) {
		.empty-state {
			padding: 4rem 2rem;
		}
	}
	
	.empty-icon {
		font-size: 3rem;
		margin-bottom: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.empty-icon {
			font-size: 4rem;
			margin-bottom: 1rem;
		}
	}
	
	.empty-state h2 {
		font-size: 1.25rem;
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.empty-state h2 {
			font-size: 1.5rem;
		}
	}
	
	.empty-state p {
		color: var(--color-text-secondary);
		margin: 0 0 1.25rem;
		font-size: 0.9rem;
	}
	
	@media (min-width: 640px) {
		.empty-state p {
			margin: 0 0 1.5rem;
		}
	}
	
	/* Events Grid - Mobile first single column */
	.events-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	
	@media (min-width: 640px) {
		.events-grid {
			gap: 1.25rem;
		}
	}
	
	@media (min-width: 768px) {
		.events-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1.5rem;
		}
	}
	
	@media (min-width: 1200px) {
		.events-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	@media (min-width: 1536px) {
		.events-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	
	/* Event Card - Touch-friendly */
	.event-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
		-webkit-tap-highlight-color: transparent;
	}
	
	.event-card:hover {
		border-color: var(--color-primary);
	}
	
	@media (hover: hover) {
		.event-card:hover {
			transform: translateY(-2px);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		}
	}
	
	.event-card.event-active {
		border-color: #57f287;
		box-shadow: 0 0 0 1px #57f287;
	}
	
	.event-image {
		width: 100%;
		height: 120px;
		overflow: hidden;
	}
	
	@media (min-width: 640px) {
		.event-image {
			height: 140px;
		}
	}
	
	.event-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	
	.event-content {
		padding: 0.875rem;
	}
	
	@media (min-width: 640px) {
		.event-content {
			padding: 1rem;
		}
	}
	
	.event-header {
		margin-bottom: 0.75rem;
	}
	
	.event-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	
	.status-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}
	
	.status-scheduled {
		background: rgba(88, 101, 242, 0.2);
		color: #5865f2;
	}
	
	.status-active {
		background: rgba(87, 242, 135, 0.2);
		color: #57f287;
	}
	
	.status-completed {
		background: rgba(153, 170, 181, 0.2);
		color: #99aab5;
	}
	
	.status-canceled {
		background: rgba(237, 66, 69, 0.2);
		color: #ed4245;
	}
	
	.entity-type {
		font-size: 0.875rem;
	}
	
	.event-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--color-text);
		line-height: 1.3;
	}
	
	@media (min-width: 640px) {
		.event-title {
			font-size: 1.1rem;
		}
	}
	
	.event-description {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0 0 1rem;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	
	.event-details {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 0.875rem;
		padding: 0.625rem;
		background: var(--color-background);
		border-radius: var(--radius-md);
	}
	
	@media (min-width: 640px) {
		.event-details {
			gap: 0.5rem;
			margin-bottom: 1rem;
			padding: 0.75rem;
		}
	}
	
	.detail-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	
	.detail-icon {
		font-size: 0.9rem;
		line-height: 1.4;
	}
	
	.detail-content {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
	}
	
	.detail-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		font-weight: 500;
		min-width: 50px;
	}
	
	.detail-value {
		font-size: 0.85rem;
		color: var(--color-text);
	}
	
	.detail-relative {
		font-size: 0.75rem;
		color: var(--color-primary);
		font-weight: 500;
	}
	
	.location-value {
		word-break: break-all;
	}
	
	.event-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	
	@media (min-width: 640px) {
		.event-actions {
			gap: 0.5rem;
		}
	}
	
	/* Make action buttons fill width on very small screens */
	@media (max-width: 400px) {
		.event-actions {
			flex-direction: column;
		}
		
		.event-actions .btn,
		.event-actions form {
			width: 100%;
		}
		
		.event-actions form .btn {
			width: 100%;
		}
	}
	
	/* Modal - Mobile-first full screen on small devices */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1000;
		padding: 0;
	}
	
	@media (min-width: 640px) {
		.modal-overlay {
			align-items: center;
			padding: 1rem;
			background: rgba(0, 0, 0, 0.7);
		}
	}
	
	.modal {
		background: var(--color-surface);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		width: 100%;
		max-height: 90vh;
		max-height: 90dvh;
		overflow-y: auto;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.3);
		animation: slideUp 0.3s ease-out;
		/* Hide scrollbar but keep functionality */
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* IE/Edge */
	}
	
	.modal::-webkit-scrollbar {
		display: none; /* Chrome, Safari, Opera */
	}
	
	@keyframes slideUp {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	
	@media (min-width: 640px) {
		.modal {
			max-width: 500px;
			border-radius: var(--radius-lg);
			box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
			animation: fadeIn 0.2s ease-out;
		}
		
		@keyframes fadeIn {
			from {
				transform: scale(0.95);
				opacity: 0;
			}
			to {
				transform: scale(1);
				opacity: 1;
			}
		}
	}
	
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		background: var(--color-surface);
		z-index: 1;
	}
	
	@media (min-width: 640px) {
		.modal-header {
			padding: 1rem 1.25rem;
		}
	}
	
	.modal-header h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}
	
	@media (min-width: 640px) {
		.modal-header h2 {
			font-size: 1.25rem;
		}
	}
	
	.modal-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.5rem;
		margin: -0.5rem;
		line-height: 1;
		border-radius: var(--radius-md);
		transition: background-color 0.2s;
		-webkit-tap-highlight-color: transparent;
	}
	
	.modal-close:hover,
	.modal-close:active {
		color: var(--color-text);
		background: var(--color-background);
	}
	
	.modal-body {
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.modal-body {
			padding: 1.25rem;
		}
	}
	
	.modal-footer {
		display: flex;
		flex-direction: column-reverse;
		gap: 0.5rem;
		padding: 1rem;
		border-top: 1px solid var(--color-border);
		position: sticky;
		bottom: 0;
		background: var(--color-surface);
	}
	
	.modal-footer .btn {
		width: 100%;
	}
	
	@media (min-width: 640px) {
		.modal-footer {
			flex-direction: row;
			justify-content: flex-end;
			gap: 0.75rem;
			padding: 1rem 1.25rem;
		}
		
		.modal-footer .btn {
			width: auto;
		}
	}
	
	/* Form Elements - Touch-friendly */
	.form-group {
		margin-bottom: 0.875rem;
	}
	
	@media (min-width: 640px) {
		.form-group {
			margin-bottom: 1rem;
		}
	}
	
	.form-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.875rem;
	}
	
	@media (min-width: 500px) {
		.form-row {
			grid-template-columns: 1fr 1fr;
			gap: 1rem;
		}
	}
	
	.form-group label {
		display: block;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		margin-bottom: 0.375rem;
	}
	
	.form-group input,
	.form-group textarea,
	.form-group select {
		width: 100%;
		padding: 0.75rem;
		font-size: 16px; /* Prevents iOS zoom on focus */
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background);
		color: var(--color-text);
		transition: border-color 0.2s;
		-webkit-appearance: none;
		appearance: none;
	}
	
	@media (min-width: 640px) {
		.form-group input,
		.form-group textarea,
		.form-group select {
			padding: 0.625rem 0.75rem;
			font-size: 0.9rem;
		}
	}
	
	.form-group select {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.75rem center;
		padding-right: 2.5rem;
	}
	
	.form-group input:focus,
	.form-group textarea:focus,
	.form-group select:focus {
		outline: none;
		border-color: var(--color-primary);
	}
	
	/* Datetime inputs on mobile - ensure they fit */
	.form-group input[type="datetime-local"] {
		min-width: 0;
		font-size: 14px;
	}
	
	@media (min-width: 640px) {
		.form-group input[type="datetime-local"] {
			font-size: 0.9rem;
		}
	}
	
	.form-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-top: 0.25rem;
	}
	
	.info-box {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem;
		background: rgba(88, 101, 242, 0.1);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}
	
	.info-box-subtle {
		background: var(--color-background);
		border: 1px solid var(--color-border);
	}
	
	.info-icon {
		flex-shrink: 0;
	}
	
	/* Modal variations */
	.modal-lg {
		max-width: 550px;
	}
	
	@media (min-width: 640px) {
		.modal-lg {
			max-width: 580px;
		}
	}
	
	/* Modal header enhancements */
	.modal-header-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	
	.modal-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		background: var(--color-primary);
		color: white;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	
	/* Current event info display */
	.current-event-info {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--color-background);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}
	
	.event-type-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		font-size: 0.8rem;
		font-weight: 500;
		background: rgba(88, 101, 242, 0.15);
		color: var(--color-text);
		border-radius: var(--radius-sm);
	}
	
	.current-channel {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		font-size: 0.8rem;
		font-weight: 500;
		background: rgba(87, 242, 135, 0.15);
		color: var(--color-text);
		border-radius: var(--radius-sm);
	}
	
	/* Form sections */
	.form-section {
		margin-bottom: 1.25rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}
	
	.form-section:last-of-type {
		border-bottom: none;
		margin-bottom: 1rem;
	}
	
	.form-section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}
	
	.recurrence-section {
		border-bottom: none;
		padding-bottom: 0;
	}
	
	.recurrence-section .recurrence-toggle {
		margin-top: 0;
		padding-top: 0;
		border-top: none;
	}
	
	/* Recurrence Options */
	.recurrence-toggle {
		margin-top: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}
	
	.toggle-label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		cursor: pointer;
		font-size: 0.9rem;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
	}
	
	.toggle-label input[type="checkbox"] {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	
	.toggle-switch {
		position: relative;
		width: 44px;
		height: 24px;
		background: var(--color-border);
		border-radius: 12px;
		transition: background-color 0.2s;
		flex-shrink: 0;
	}
	
	.toggle-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		background: white;
		border-radius: 50%;
		transition: transform 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}
	
	.toggle-label input:checked + .toggle-switch {
		background: var(--color-primary);
	}
	
	.toggle-label input:checked + .toggle-switch::after {
		transform: translateX(20px);
	}
	
	.toggle-label input:focus-visible + .toggle-switch {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	
	.toggle-text {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	
	.recurrence-options {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: var(--color-background);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}
	
	@media (min-width: 640px) {
		.recurrence-options {
			padding: 1rem;
		}
	}
	
	.interval-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.interval-input input {
		flex: 0 0 70px;
		text-align: center;
	}
	
	@media (min-width: 640px) {
		.interval-input input {
			flex: 0 0 80px;
		}
	}
	
	.interval-label {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}
	
	.weekday-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.375rem;
	}
	
	.weekday-btn {
		padding: 0.5rem 0.625rem;
		font-size: 0.75rem;
		font-weight: 500;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.2s;
		min-width: 44px;
		-webkit-tap-highlight-color: transparent;
	}
	
	.weekday-btn:hover {
		border-color: var(--color-primary);
	}
	
	.weekday-btn.selected {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}
	
	@media (min-width: 640px) {
		.weekday-btn {
			padding: 0.375rem 0.5rem;
			min-width: auto;
		}
	}
	
	/* Image Upload Styles */
	.image-upload-area {
		position: relative;
	}
	
	.image-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}
	
	.image-upload-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1.5rem;
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background);
		cursor: pointer;
		transition: border-color 0.2s, background-color 0.2s;
		text-align: center;
	}
	
	.image-upload-label:hover {
		border-color: var(--color-primary);
		background: rgba(88, 101, 242, 0.05);
	}
	
	.upload-icon {
		font-size: 2rem;
	}
	
	.upload-text {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--color-text);
	}
	
	.upload-hint {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
	
	.image-preview {
		position: relative;
		border-radius: var(--radius-md);
		overflow: hidden;
		aspect-ratio: 16 / 9;
		background: var(--color-background);
	}
	
	.image-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	
	.image-remove-btn {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.7);
		color: white;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		transition: background-color 0.2s, transform 0.1s;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	
	.image-remove-btn:hover {
		background: rgba(237, 66, 69, 0.9);
	}
	
	.image-remove-btn:active {
		transform: scale(0.95);
	}
	
	.image-change-btn {
		display: block;
		margin-top: 0.5rem;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-primary);
		background: transparent;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color 0.2s, color 0.2s;
	}
	
	.image-change-btn:hover {
		background: var(--color-primary);
		color: white;
	}
	
	/* Edit Choice Modal Styles */
	.modal-choice {
		min-width: 450px;
		max-width: 500px;
	}
	
	.choice-body {
		padding: 1.5rem;
	}
	
	.choice-description {
		color: var(--color-text-secondary);
		margin-bottom: 1.5rem;
		font-size: 0.95rem;
		line-height: 1.5;
	}
	
	.choice-options {
		display: grid;
		gap: 1rem;
	}
	
	.choice-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-background);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
	}
	
	.choice-card:hover {
		border-color: var(--color-primary);
		background: rgba(88, 101, 242, 0.05);
		transform: translateY(-1px);
	}
	
	.choice-card-primary {
		border-color: var(--color-primary);
		background: rgba(88, 101, 242, 0.08);
	}
	
	.choice-card-primary:hover {
		background: rgba(88, 101, 242, 0.12);
	}
	
	.choice-icon {
		font-size: 1.75rem;
		flex-shrink: 0;
	}
	
	.choice-content {
		flex: 1;
	}
	
	.choice-title {
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.25rem;
		font-size: 1rem;
	}
	
	.choice-subtitle {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		line-height: 1.4;
	}
	
	/* Occurrence Info Styles (for single-edit mode) */
	.occurrence-info {
		padding: 1.25rem;
		background: linear-gradient(135deg, rgba(88, 101, 242, 0.1) 0%, rgba(88, 101, 242, 0.05) 100%);
		border-radius: var(--radius-lg);
		border: 1px solid rgba(88, 101, 242, 0.2);
	}
	
	.occurrence-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	
	.occurrence-icon {
		font-size: 1.5rem;
	}
	
	.occurrence-details {
		flex: 1;
	}
	
	.occurrence-title {
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}
	
	.occurrence-subtitle {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}
	
	.section-hint {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin-bottom: 1rem;
		font-style: italic;
	}
</style>
