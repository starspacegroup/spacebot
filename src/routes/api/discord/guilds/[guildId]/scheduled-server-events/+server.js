/**
 * Discord Guild Scheduled Events API
 * GET - Fetch scheduled events for a guild (or single event with ?eventId=)
 * POST - Create a new scheduled event
 * PATCH - Update an existing scheduled event
 * DELETE - Delete a scheduled event
 * 
 * Additional query params:
 * - GET ?eventId=123 - Get a single event
 * - GET ?eventId=123&users=true - Get event subscribers
 * - PATCH ?eventId=123&action=start - Start an event
 * - PATCH ?eventId=123&action=end - End an event
 * - PATCH ?eventId=123&action=cancel - Cancel an event
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/**
 * Discord scheduled event entity types
 * @see https://discord.com/developers/docs/resources/guild-scheduled-event#guild-scheduled-event-object-guild-scheduled-event-entity-types
 */
const ENTITY_TYPES = {
  1: "stage_instance",
  2: "voice",
  3: "external",
};

/**
 * Discord scheduled event status
 * @see https://discord.com/developers/docs/resources/guild-scheduled-event#guild-scheduled-event-object-guild-scheduled-event-status
 */
const EVENT_STATUS = {
  1: "scheduled",
  2: "active",
  3: "completed",
  4: "canceled",
};

/**
 * Privacy level
 */
const PRIVACY_LEVELS = {
  2: "guild_only",
};

/**
 * Recurrence rule frequency
 */
const RECURRENCE_FREQUENCY = {
  0: "yearly",
  1: "monthly",
  2: "weekly",
  3: "daily",
};

/**
 * Recurrence rule weekday
 */
const RECURRENCE_WEEKDAY = {
  0: "monday",
  1: "tuesday",
  2: "wednesday",
  3: "thursday",
  4: "friday",
  5: "saturday",
  6: "sunday",
};

/**
 * Format a scheduled event from Discord API response
 */
function formatEvent(event) {
  return {
    id: event.id,
    guildId: event.guild_id,
    channelId: event.channel_id,
    creatorId: event.creator_id,
    name: event.name,
    description: event.description,
    scheduledStartTime: event.scheduled_start_time,
    scheduledEndTime: event.scheduled_end_time,
    privacyLevel: PRIVACY_LEVELS[event.privacy_level] || "unknown",
    status: EVENT_STATUS[event.status] || "unknown",
    statusRaw: event.status,
    entityType: ENTITY_TYPES[event.entity_type] || "unknown",
    entityTypeRaw: event.entity_type,
    entityId: event.entity_id,
    entityMetadata: event.entity_metadata,
    creator: event.creator,
    userCount: event.user_count,
    image: event.image ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png` : null,
    imageHash: event.image,
    recurrenceRule: event.recurrence_rule ? {
      start: event.recurrence_rule.start,
      end: event.recurrence_rule.end,
      frequency: RECURRENCE_FREQUENCY[event.recurrence_rule.frequency] || "unknown",
      frequencyRaw: event.recurrence_rule.frequency,
      interval: event.recurrence_rule.interval,
      byWeekday: event.recurrence_rule.by_weekday?.map(d => RECURRENCE_WEEKDAY[d]) || [],
      byNWeekday: event.recurrence_rule.by_n_weekday,
      byMonth: event.recurrence_rule.by_month,
      byMonthDay: event.recurrence_rule.by_month_day,
      byYearDay: event.recurrence_rule.by_year_day,
      count: event.recurrence_rule.count,
    } : null,
  };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform, url }) {
  const { guildId } = params;
  const eventId = url.searchParams.get("eventId");
  const withUsers = url.searchParams.get("users") === "true";
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  // Verify user has access to this guild
  const authCheck = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!authCheck.authorized) {
    return json({ error: authCheck.error }, { status: 403 });
  }

  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    // If eventId is provided, fetch single event or its users
    if (eventId) {
      if (withUsers) {
        // Fetch event subscribers/interested users
        const response = await fetch(
          `https://discord.com/api/v10/guilds/${guildId}/scheduled-events/${eventId}/users?limit=100`,
          {
            headers: {
              Authorization: `Bot ${botToken}`,
            },
          },
        );

        if (!response.ok) {
          const error = await response.text();
          log.error("Discord API error fetching event users:", error);
          return json({ error: "Failed to fetch event users" }, { status: response.status });
        }

        const users = await response.json();
        return json({
          eventId,
          users: users.map(u => ({
            id: u.user.id,
            username: u.user.username,
            globalName: u.user.global_name,
            avatar: u.user.avatar,
            discriminator: u.user.discriminator,
          })),
          count: users.length,
        });
      }

      // Fetch single event
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/scheduled-events/${eventId}?with_user_count=true`,
        {
          headers: {
            Authorization: `Bot ${botToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        log.error("Discord API error fetching event:", error);
        return json({ error: "Failed to fetch event" }, { status: response.status });
      }

      const rawEvent = await response.json();
      return json({ event: formatEvent(rawEvent) });
    }

    // Fetch all scheduled events from Discord API using bot token
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events?with_user_count=true`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      log.error("Discord API error fetching events:", error);
      return json({ error: "Failed to fetch scheduled events" }, { status: response.status });
    }

    const rawEvents = await response.json();
    
    // Format events
    const events = rawEvents.map(formatEvent);
    
    // Sort by scheduled start time
    events.sort((a, b) => new Date(a.scheduledStartTime) - new Date(b.scheduledStartTime));

    return json({ 
      events,
      count: events.length,
    });
  } catch (error) {
    log.error("Error fetching scheduled events:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, cookies, platform, request }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  // Verify user has access to this guild
  const authCheck = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!authCheck.authorized) {
    return json({ error: authCheck.error }, { status: 403 });
  }

  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    
    // Build the event payload for Discord API
    const eventPayload = {
      name: body.name,
      privacy_level: 2, // Guild only
      scheduled_start_time: body.scheduledStartTime,
      entity_type: body.entityType,
    };

    // Add optional fields
    if (body.description) {
      eventPayload.description = body.description;
    }
    if (body.scheduledEndTime) {
      eventPayload.scheduled_end_time = body.scheduledEndTime;
    }
    if (body.channelId && body.entityType !== 3) {
      eventPayload.channel_id = body.channelId;
    }
    // For external events (entityType 3), location AND scheduled_end_time are required
    if (body.entityType === 3) {
      eventPayload.entity_metadata = { location: body.entityMetadata?.location || "To be announced" };
      // Discord requires end time for external events - default to 3 hours after start
      if (!eventPayload.scheduled_end_time) {
        const startTime = new Date(body.scheduledStartTime);
        const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);
        eventPayload.scheduled_end_time = endTime.toISOString();
      }
    }
    if (body.image) {
      eventPayload.image = body.image;
    }
    
    // Add recurrence rule if provided
    if (body.recurrenceRule) {
      const recurrenceRule = {
        start: body.recurrenceRule.start || body.scheduledStartTime,
        frequency: body.recurrenceRule.frequency,
        interval: body.recurrenceRule.interval || 1,
      };
      
      if (body.recurrenceRule.byWeekday && body.recurrenceRule.byWeekday.length > 0) {
        recurrenceRule.by_weekday = body.recurrenceRule.byWeekday;
      }
      if (body.recurrenceRule.byNWeekday) {
        recurrenceRule.by_n_weekday = body.recurrenceRule.byNWeekday;
      }
      if (body.recurrenceRule.byMonth) {
        recurrenceRule.by_month = body.recurrenceRule.byMonth;
      }
      if (body.recurrenceRule.byMonthDay) {
        recurrenceRule.by_month_day = body.recurrenceRule.byMonthDay;
      }
      if (body.recurrenceRule.byYearDay) {
        recurrenceRule.by_year_day = body.recurrenceRule.byYearDay;
      }
      if (body.recurrenceRule.count) {
        recurrenceRule.count = body.recurrenceRule.count;
      }
      if (body.recurrenceRule.end) {
        recurrenceRule.end = body.recurrenceRule.end;
      }
      
      eventPayload.recurrence_rule = recurrenceRule;
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`,
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
      return json({ error: error.message || "Failed to create event" }, { status: response.status });
    }

    const newEvent = await response.json();
    return json({ event: formatEvent(newEvent) }, { status: 201 });
  } catch (error) {
    log.error("Error creating scheduled event:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, cookies, platform, request, url }) {
  const { guildId } = params;
  const eventId = url.searchParams.get("eventId");
  const action = url.searchParams.get("action"); // start, end, cancel
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  if (!eventId) {
    return json({ error: "Event ID is required" }, { status: 400 });
  }

  // Verify user has access to this guild
  const authCheck = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!authCheck.authorized) {
    return json({ error: authCheck.error }, { status: 403 });
  }

  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    let updatePayload = {};

    // Handle action-based updates
    if (action) {
      switch (action) {
        case "start":
          updatePayload.status = 2; // Active
          break;
        case "end":
          updatePayload.status = 3; // Completed
          break;
        case "cancel":
          updatePayload.status = 4; // Canceled
          break;
        default:
          return json({ error: `Unknown action: ${action}` }, { status: 400 });
      }
    } else {
      // Regular update from request body
      const body = await request.json();
      
      if (body.name !== undefined) updatePayload.name = body.name;
      if (body.description !== undefined) updatePayload.description = body.description;
      if (body.scheduledStartTime !== undefined) updatePayload.scheduled_start_time = body.scheduledStartTime;
      if (body.scheduledEndTime !== undefined) updatePayload.scheduled_end_time = body.scheduledEndTime;
      if (body.channelId !== undefined) updatePayload.channel_id = body.channelId;
      if (body.entityMetadata !== undefined) updatePayload.entity_metadata = body.entityMetadata;
      if (body.status !== undefined) updatePayload.status = body.status;
      if (body.image !== undefined) updatePayload.image = body.image;
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events/${eventId}`,
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
      return json({ error: error.message || "Failed to update event" }, { status: response.status });
    }

    const updatedEvent = await response.json();
    return json({ 
      event: formatEvent(updatedEvent),
      action: action || "update",
    });
  } catch (error) {
    log.error("Error updating scheduled event:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, cookies, platform, url }) {
  const { guildId } = params;
  const eventId = url.searchParams.get("eventId");
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  if (!eventId) {
    return json({ error: "Event ID is required" }, { status: 400 });
  }

  // Verify user has access to this guild
  const authCheck = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!authCheck.authorized) {
    return json({ error: authCheck.error }, { status: 403 });
  }

  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events/${eventId}`,
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
      return json({ error: error.message || "Failed to delete event" }, { status: response.status });
    }

    return json({ success: true });
  } catch (error) {
    log.error("Error deleting scheduled event:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
