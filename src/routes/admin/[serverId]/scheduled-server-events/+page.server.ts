import { fail, redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { hasFullAdminPermission } from "$lib/discord/guilds.js";
import {
  getCachedScheduledEvents,
  setCachedScheduledEvents,
  getCachedVoiceChannels,
  setCachedVoiceChannels,
  invalidateScheduledEvents,
  fetchWithRateLimitRetry,
} from "$lib/discord/cache.js";

interface RecurrenceRulePayload {
  start: string;
  frequency: number;
  interval: number;
  by_weekday?: number[];
  count?: number;
}

interface EventPayload {
  name: FormDataEntryValue;
  privacy_level: number;
  scheduled_start_time: string;
  entity_type: number;
  description?: FormDataEntryValue;
  scheduled_end_time?: string;
  image?: FormDataEntryValue;
  entity_metadata?: { location: FormDataEntryValue };
  channel_id?: FormDataEntryValue;
  recurrence_rule?: RecurrenceRulePayload;
}

interface UpdateEventPayload {
  name?: FormDataEntryValue;
  description?: FormDataEntryValue;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  entity_type?: number;
  image?: FormDataEntryValue | null;
  entity_metadata?: { location: FormDataEntryValue };
  channel_id?: FormDataEntryValue;
  recurrence_rule?: RecurrenceRulePayload | null;
}

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId: string | undefined, platform: any) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(Boolean);

  return superAdminIdList.includes(userId);
}

/**
 * Fetch scheduled events from Discord API with caching and rate limit retry
 */
async function fetchScheduledEvents(botToken, guildId) {
  // Check cache first
  const cached = getCachedScheduledEvents(guildId);
  if (cached !== null) {
    log.debug("[ScheduledEvents] Returning cached events:", cached.length);
    return cached;
  }

  try {
    const response = await fetchWithRateLimitRetry(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events?with_user_count=true`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      log.error("Failed to fetch scheduled events:", response.status);
      return [];
    }

    const events = await response.json();
    setCachedScheduledEvents(guildId, events);
    return events;
  } catch (error) {
    log.error("Error fetching scheduled events:", error);
    return [];
  }
}

/**
 * Fetch voice/stage channels for event creation with caching
 */
async function fetchVoiceChannels(botToken, guildId) {
  // Check cache first
  const cached = getCachedVoiceChannels(guildId);
  if (cached !== null) {
    log.debug("[ScheduledEvents] Returning cached voice channels:", cached.length);
    return cached;
  }

  try {
    const response = await fetchWithRateLimitRetry(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const channels = await response.json();
    // Filter to voice (2) and stage (13) channels
    const voiceChannels = channels
      .filter(c => c.type === 2 || c.type === 13)
      .map(c => ({
        id: c.id,
        name: c.name,
        type: c.type === 2 ? 'voice' : 'stage',
        parentId: c.parent_id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    setCachedVoiceChannels(guildId, voiceChannels);
    return voiceChannels;
  } catch (error) {
    log.error("Error fetching voice channels:", error);
    return [];
  }
}

/**
 * Event status constants
 */
const EVENT_STATUS = {
  1: { name: "Scheduled", color: "#5865f2" },
  2: { name: "Active", color: "#57f287" },
  3: { name: "Completed", color: "#99aab5" },
  4: { name: "Canceled", color: "#ed4245" },
};

/**
 * Entity type constants
 */
const ENTITY_TYPES = {
  1: { name: "Stage Instance", icon: "🎭" },
  2: { name: "Voice", icon: "🔊" },
  3: { name: "External", icon: "📍" },
};

/**
 * Recurrence frequency constants
 */
const RECURRENCE_FREQUENCY = {
  0: "Yearly",
  1: "Monthly",
  2: "Weekly",
  3: "Daily",
};

/**
 * Weekday names
 */
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  if (!/^\d{17,20}$/.test(params.serverId)) {
    throw redirect(302, "/admin");
  }

  const parentData = await parent();
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    throw redirect(302, "/login");
  }

  const serverId = params.serverId;
  const isSuperAdmin = checkIsSuperAdmin(userId, platform);
  const adminGuilds = parentData.adminGuilds || [];

  // Check if user has access to this specific server
  const hasAccessToServer = isSuperAdmin ||
    adminGuilds.some((g) => g.id === serverId);

  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  // Get guild info
  const guild = adminGuilds.find((g) => g.id === serverId);
  const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);

  // Fetch scheduled events and voice channels
  const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  let events = [];
  let voiceChannels = [];

  if (botToken) {
    const [rawEvents, channels] = await Promise.all([
      fetchScheduledEvents(botToken, serverId),
      fetchVoiceChannels(botToken, serverId),
    ]);

    voiceChannels = channels;

    // Format events for the UI
    events = rawEvents.map(event => ({
      id: event.id,
      name: event.name,
      description: event.description || "",
      scheduledStartTime: event.scheduled_start_time,
      scheduledEndTime: event.scheduled_end_time,
      status: event.status,
      statusInfo: EVENT_STATUS[event.status] || { name: "Unknown", color: "#888" },
      entityType: event.entity_type,
      entityTypeInfo: ENTITY_TYPES[event.entity_type] || { name: "Unknown", icon: "❓" },
      channelId: event.channel_id,
      creatorId: event.creator_id,
      userCount: event.user_count || 0,
      location: event.entity_metadata?.location || null,
      image: event.image ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png?size=512` : null,
      imageHash: event.image,
      recurrenceRule: event.recurrence_rule ? {
        frequency: event.recurrence_rule.frequency,
        frequencyName: RECURRENCE_FREQUENCY[event.recurrence_rule.frequency] || "Unknown",
        interval: event.recurrence_rule.interval,
        byWeekday: event.recurrence_rule.by_weekday?.map(d => WEEKDAY_NAMES[d]) || [],
        count: event.recurrence_rule.count,
      } : null,
    }));

    // Sort: active first, then scheduled (by start time), then completed/canceled
    events.sort((a, b) => {
      // Active events first
      if (a.status === 2 && b.status !== 2) return -1;
      if (b.status === 2 && a.status !== 2) return 1;
      // Then scheduled events
      if (a.status === 1 && b.status !== 1) return -1;
      if (b.status === 1 && a.status !== 1) return 1;
      // Sort by start time within same status
      return new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime();
    });
  }

  return {
    serverId,
    guild,
    hasFullAdminAccess,
    isSuperAdmin,
    events,
    voiceChannels,
    constants: {
      eventStatus: EVENT_STATUS,
      entityTypes: ENTITY_TYPES,
      recurrenceFrequency: RECURRENCE_FREQUENCY,
      weekdayNames: WEEKDAY_NAMES,
    },
  };
}

/** @type {import('./$types').Actions} */
export const actions = {
  create: async ({ request, cookies, platform, params }) => {
    const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      return fail(500, { error: "Bot token not configured" });
    }

    const formData = await request.formData();
    const name = formData.get("name");
    const description = formData.get("description");
    const entityType = parseInt((formData.get("entityType") as string) || "3");
    const channelId = formData.get("channelId");
    const location = formData.get("location");
    const scheduledStartTime = formData.get("scheduledStartTime");
    const scheduledEndTime = formData.get("scheduledEndTime");
    const image = formData.get("image"); // Base64 data URI

    // Recurrence options
    const recurrenceEnabled = formData.get("recurrenceEnabled") === "true";
    const recurrenceFrequency = parseInt((formData.get("recurrenceFrequency") as string) || "2");
    const recurrenceInterval = parseInt((formData.get("recurrenceInterval") as string) || "1");
    const recurrenceWeekdaysStr = formData.get("recurrenceWeekdays") || "";
    const recurrenceCount = formData.get("recurrenceCount") ? parseInt(formData.get("recurrenceCount") as string) : null;

    if (!name || !scheduledStartTime) {
      return fail(400, { error: "Name and start time are required" });
    }

    // Build the event payload
    const eventPayload: EventPayload = {
      name,
      privacy_level: 2, // Guild only
      scheduled_start_time: new Date(scheduledStartTime as string).toISOString(),
      entity_type: entityType,
    };

    if (description) eventPayload.description = description;
    if (scheduledEndTime) eventPayload.scheduled_end_time = new Date(scheduledEndTime as string).toISOString();

    // Add image if provided (as base64 data URI)
    if (image && (image as string).startsWith('data:image/')) {
      eventPayload.image = image;
    }
    
    if (entityType === 3) {
      // External event - requires location and end time
      if (!location) {
        return fail(400, { error: "Location is required for external events" });
      }
      if (!scheduledEndTime) {
        return fail(400, { error: "End time is required for external events" });
      }
      eventPayload.entity_metadata = { location };
    } else {
      // Voice or Stage event
      if (!channelId) {
        return fail(400, { error: "Channel is required for voice/stage events" });
      }
      eventPayload.channel_id = channelId;
    }
    
    // Add recurrence rule if enabled
    if (recurrenceEnabled) {
      const recurrenceRule: RecurrenceRulePayload = {
        start: new Date(scheduledStartTime as string).toISOString(),
        frequency: recurrenceFrequency,
        interval: recurrenceInterval,
      };

      // Add weekdays for weekly recurrence
      if (recurrenceFrequency === 2 && recurrenceWeekdaysStr) {
        const weekdays = (recurrenceWeekdaysStr as string).split(",").filter(Boolean).map(d => parseInt(d));
        if (weekdays.length > 0) {
          recurrenceRule.by_weekday = weekdays;
        }
      }

      // Add count if specified
      if (recurrenceCount && recurrenceCount > 0) {
        recurrenceRule.count = recurrenceCount;
      }

      eventPayload.recurrence_rule = recurrenceRule;
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${params.serverId}/scheduled-events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        log.error("Discord API error creating event:", error);
        return fail(response.status, { error: error.message || "Failed to create event" });
      }

      // Invalidate cache so fresh data is fetched
      invalidateScheduledEvents(params.serverId);
      return { success: true, message: "Event created successfully!" };
    } catch (error) {
      log.error("Error creating scheduled event:", error);
      return fail(500, { error: "Internal server error" });
    }
  },

  update: async ({ request, cookies, platform, params }) => {
    const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      return fail(500, { error: "Bot token not configured" });
    }

    const formData = await request.formData();
    const eventId = formData.get("eventId");
    const name = formData.get("name");
    const description = formData.get("description");
    const entityType = parseInt((formData.get("entityType") as string) || "3");
    const channelId = formData.get("channelId");
    const location = formData.get("location");
    const scheduledStartTime = formData.get("scheduledStartTime");
    const scheduledEndTime = formData.get("scheduledEndTime");
    const image = formData.get("image"); // Base64 data URI for new image
    const removeImage = formData.get("removeImage") === "true";

    // Recurrence options
    const recurrenceEnabled = formData.get("recurrenceEnabled") === "true";
    const recurrenceFrequency = parseInt((formData.get("recurrenceFrequency") as string) || "2");
    const recurrenceInterval = parseInt((formData.get("recurrenceInterval") as string) || "1");
    const recurrenceWeekdaysStr = formData.get("recurrenceWeekdays") || "";
    const recurrenceCount = formData.get("recurrenceCount") ? parseInt(formData.get("recurrenceCount") as string) : null;

    if (!eventId) {
      return fail(400, { error: "Event ID is required" });
    }

    // Build the update payload
    const updatePayload: UpdateEventPayload = {};
    if (name) updatePayload.name = name;
    if (description !== null) updatePayload.description = description;
    if (scheduledStartTime) updatePayload.scheduled_start_time = new Date(scheduledStartTime as string).toISOString();
    if (scheduledEndTime) updatePayload.scheduled_end_time = new Date(scheduledEndTime as string).toISOString();

    // Handle entity type change
    updatePayload.entity_type = entityType;

    // Handle image updates
    if (image && (image as string).startsWith('data:image/')) {
      updatePayload.image = image;
    } else if (removeImage) {
      updatePayload.image = null;
    }

    // Handle location for external events
    if (entityType === 3 && location) {
      updatePayload.entity_metadata = { location };
    }

    // Handle channel change for voice/stage events
    if ((entityType === 1 || entityType === 2) && channelId) {
      updatePayload.channel_id = channelId;
    }

    // Handle recurrence rule updates
    if (recurrenceEnabled) {
      const recurrenceRule: RecurrenceRulePayload = {
        start: scheduledStartTime ? new Date(scheduledStartTime as string).toISOString() : new Date().toISOString(),
        frequency: recurrenceFrequency,
        interval: recurrenceInterval,
      };

      // Add weekdays for weekly recurrence
      if (recurrenceFrequency === 2 && recurrenceWeekdaysStr) {
        const weekdays = (recurrenceWeekdaysStr as string).split(",").filter(Boolean).map(d => parseInt(d));
        if (weekdays.length > 0) {
          recurrenceRule.by_weekday = weekdays;
        }
      }
      
      // Add count if specified
      if (recurrenceCount && recurrenceCount > 0) {
        recurrenceRule.count = recurrenceCount;
      }
      
      updatePayload.recurrence_rule = recurrenceRule;
    } else {
      // Explicitly remove recurrence rule if unchecked
      updatePayload.recurrence_rule = null;
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${params.serverId}/scheduled-events/${eventId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatePayload),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        log.error("Discord API error updating event:", error);
        return fail(response.status, { error: error.message || "Failed to update event" });
      }

      // Invalidate cache so fresh data is fetched
      invalidateScheduledEvents(params.serverId);
      return { success: true, message: "Event updated successfully!" };
    } catch (error) {
      log.error("Error updating scheduled event:", error);
      return fail(500, { error: "Internal server error" });
    }
  },

  delete: async ({ request, cookies, platform, params }) => {
    const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      return fail(500, { error: "Bot token not configured" });
    }

    const formData = await request.formData();
    const eventId = formData.get("eventId");

    if (!eventId) {
      return fail(400, { error: "Event ID is required" });
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${params.serverId}/scheduled-events/${eventId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bot ${botToken}`,
          },
        },
      );

      if (!response.ok && response.status !== 204) {
        const error = await response.json();
        log.error("Discord API error deleting event:", error);
        return fail(response.status, { error: error.message || "Failed to delete event" });
      }

      // Invalidate cache so fresh data is fetched
      invalidateScheduledEvents(params.serverId);
      return { success: true, message: "Event deleted successfully!" };
    } catch (error) {
      log.error("Error deleting scheduled event:", error);
      return fail(500, { error: "Internal server error" });
    }
  },

  start: async ({ request, cookies, platform, params }) => {
    const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      return fail(500, { error: "Bot token not configured" });
    }

    const formData = await request.formData();
    const eventId = formData.get("eventId");

    if (!eventId) {
      return fail(400, { error: "Event ID is required" });
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${params.serverId}/scheduled-events/${eventId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: 2 }), // 2 = Active
        },
      );

      if (!response.ok) {
        const error = await response.json();
        log.error("Discord API error starting event:", error);
        return fail(response.status, { error: error.message || "Failed to start event" });
      }

      // Invalidate cache so fresh data is fetched
      invalidateScheduledEvents(params.serverId);
      return { success: true, message: "Event started!" };
    } catch (error) {
      log.error("Error starting scheduled event:", error);
      return fail(500, { error: "Internal server error" });
    }
  },

  end: async ({ request, cookies, platform, params }) => {
    const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      return fail(500, { error: "Bot token not configured" });
    }

    const formData = await request.formData();
    const eventId = formData.get("eventId");

    if (!eventId) {
      return fail(400, { error: "Event ID is required" });
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${params.serverId}/scheduled-events/${eventId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: 3 }), // 3 = Completed
        },
      );

      if (!response.ok) {
        const error = await response.json();
        log.error("Discord API error ending event:", error);
        return fail(response.status, { error: error.message || "Failed to end event" });
      }

      // Invalidate cache so fresh data is fetched
      invalidateScheduledEvents(params.serverId);
      return { success: true, message: "Event ended!" };
    } catch (error) {
      log.error("Error ending scheduled event:", error);
      return fail(500, { error: "Internal server error" });
    }
  },

  cancel: async ({ request, cookies, platform, params }) => {
    const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      return fail(500, { error: "Bot token not configured" });
    }

    const formData = await request.formData();
    const eventId = formData.get("eventId");

    if (!eventId) {
      return fail(400, { error: "Event ID is required" });
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${params.serverId}/scheduled-events/${eventId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: 4 }), // 4 = Canceled
        },
      );

      if (!response.ok) {
        const error = await response.json();
        log.error("Discord API error canceling event:", error);
        return fail(response.status, { error: error.message || "Failed to cancel event" });
      }

      // Invalidate cache so fresh data is fetched
      invalidateScheduledEvents(params.serverId);
      return { success: true, message: "Event canceled!" };
    } catch (error) {
      log.error("Error canceling scheduled event:", error);
      return fail(500, { error: "Internal server error" });
    }
  },
};
