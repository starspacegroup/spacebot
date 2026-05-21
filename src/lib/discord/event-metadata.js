const DEFAULT_CATEGORY_KEY = "event";

const DEFAULT_CATEGORY_META = {
  name: "Event",
  description: "Discord event",
  color: "#888",
  icon: "📌",
};

export const DISCORD_EVENT_CATEGORIES = {
  member: {
    name: "Member",
    description: "Member joins, leaves, updates",
    color: "#5865F2",
    icon: "👤",
  },
  message: {
    name: "Message",
    description: "Message create, edit, delete",
    color: "#57F287",
    icon: "💬",
  },
  voice: {
    name: "Voice",
    description: "Voice channel activity",
    color: "#FEE75C",
    icon: "🎤",
  },
  channel: {
    name: "Channel",
    description: "Channel modifications",
    color: "#EB459E",
    icon: "📁",
  },
  role: {
    name: "Role",
    description: "Role changes",
    color: "#ED4245",
    icon: "🏷️",
  },
  guild: {
    name: "Server",
    description: "Server settings changes",
    color: "#9B59B6",
    icon: "⚙️",
  },
  emoji: {
    name: "Emoji",
    description: "Emoji and sticker changes",
    color: "#F1C40F",
    icon: "😀",
  },
  invite: {
    name: "Invite",
    description: "Invite creation and deletion",
    color: "#3498DB",
    icon: "🔗",
  },
  moderation: {
    name: "Moderation",
    description: "Kicks, bans, timeouts",
    color: "#E74C3C",
    icon: "🔨",
  },
  interaction: {
    name: "Interaction",
    description: "Commands and interactions",
    color: "#1ABC9C",
    icon: "⚡",
  },
  thread: {
    name: "Thread",
    description: "Thread activity",
    color: "#2ECC71",
    icon: "🧵",
  },
  reaction: {
    name: "Reaction",
    description: "Message reactions",
    color: "#E91E63",
    icon: "❤️",
  },
  event: {
    name: "Scheduled Event",
    description: "Scheduled event activity",
    color: "#7289DA",
    icon: "📅",
  },
  github: {
    name: "GitHub",
    description: "GitHub repository activity",
    color: "#24292e",
    icon: "🐙",
  },
};

export const DISCORD_EVENT_TYPES = {
  MEMBER_JOIN: { category: "member", description: "Member joined the server", icon: "➕" },
  MEMBER_LEAVE: { category: "member", description: "Member left the server", icon: "➖" },
  MEMBER_UPDATE: { category: "member", description: "Member was updated", icon: "✏️" },
  MEMBER_BAN: { category: "moderation", description: "Member was banned", icon: "🚫" },
  MEMBER_UNBAN: { category: "moderation", description: "Member was unbanned", icon: "🔓" },
  MEMBER_KICK: { category: "moderation", description: "Member was kicked", icon: "👢" },
  MEMBER_TIMEOUT: { category: "moderation", description: "Member was timed out", icon: "⏳" },

  MESSAGE_CREATE: { category: "message", description: "Message was sent", icon: "💬" },
  MESSAGE_UPDATE: { category: "message", description: "Message was edited", icon: "✏️" },
  MESSAGE_DELETE: { category: "message", description: "Message was deleted", icon: "🗑️" },
  MESSAGE_BULK_DELETE: { category: "message", description: "Messages were bulk deleted", icon: "🧹" },

  VOICE_JOIN: { category: "voice", description: "Joined voice channel", icon: "📥" },
  VOICE_LEAVE: { category: "voice", description: "Left voice channel", icon: "📤" },
  VOICE_MOVE: { category: "voice", description: "Moved between voice channels", icon: "🔁" },
  VOICE_SELF_MUTE: { category: "voice", description: "User muted themselves", icon: "🔇" },
  VOICE_SELF_UNMUTE: { category: "voice", description: "User unmuted themselves", icon: "🔊" },
  VOICE_SERVER_MUTE: { category: "voice", description: "User was server muted by moderator", icon: "🔇" },
  VOICE_SERVER_UNMUTE: { category: "voice", description: "User was server unmuted by moderator", icon: "🔊" },
  VOICE_SELF_DEAFEN: { category: "voice", description: "User deafened themselves", icon: "🙉" },
  VOICE_SELF_UNDEAFEN: { category: "voice", description: "User undeafened themselves", icon: "👂" },
  VOICE_SERVER_DEAFEN: { category: "voice", description: "User was server deafened by moderator", icon: "🙉" },
  VOICE_SERVER_UNDEAFEN: { category: "voice", description: "User was server undeafened by moderator", icon: "👂" },
  VOICE_STREAM_START: { category: "voice", description: "Started streaming", icon: "🖥️" },
  VOICE_STREAM_STOP: { category: "voice", description: "Stopped streaming", icon: "🛑" },
  VOICE_VIDEO_START: { category: "voice", description: "Started video", icon: "🎥" },
  VOICE_VIDEO_STOP: { category: "voice", description: "Stopped video", icon: "📷" },
  VOICE_STAGE_SUPPRESS: { category: "voice", description: "User was suppressed in stage channel", icon: "🤐" },
  VOICE_STAGE_UNSUPPRESS: { category: "voice", description: "User was made speaker in stage channel", icon: "🎤" },
  VOICE_STAGE_REQUEST_TO_SPEAK: { category: "voice", description: "User requested to speak in stage channel", icon: "✋" },
  VOICE_STAGE_REQUEST_CANCELLED: { category: "voice", description: "User cancelled request to speak in stage channel", icon: "✖️" },

  CHANNEL_CREATE: { category: "channel", description: "Channel was created", icon: "🆕" },
  CHANNEL_DELETE: { category: "channel", description: "Channel was deleted", icon: "🗑️" },
  CHANNEL_UPDATE: { category: "channel", description: "Channel was updated", icon: "⚙️" },
  CHANNEL_PINS_UPDATE: { category: "channel", description: "Channel pins were updated", icon: "📌" },

  ROLE_CREATE: { category: "role", description: "Role was created", icon: "🆕" },
  ROLE_DELETE: { category: "role", description: "Role was deleted", icon: "🗑️" },
  ROLE_UPDATE: { category: "role", description: "Role was updated", icon: "✏️" },
  MEMBER_ROLE_ADD: { category: "role", description: "Role was added to member", icon: "➕" },
  MEMBER_ROLE_REMOVE: { category: "role", description: "Role was removed from member", icon: "➖" },

  GUILD_UPDATE: { category: "guild", description: "Server settings were updated", icon: "⚙️" },

  EMOJI_CREATE: { category: "emoji", description: "Emoji was created", icon: "😀" },
  EMOJI_DELETE: { category: "emoji", description: "Emoji was deleted", icon: "🗑️" },
  EMOJI_UPDATE: { category: "emoji", description: "Emoji was updated", icon: "✏️" },
  STICKER_CREATE: { category: "emoji", description: "Sticker was created", icon: "🧩" },
  STICKER_DELETE: { category: "emoji", description: "Sticker was deleted", icon: "🗑️" },
  STICKER_UPDATE: { category: "emoji", description: "Sticker was updated", icon: "✏️" },

  INVITE_CREATE: { category: "invite", description: "Invite was created", icon: "🔗" },
  INVITE_DELETE: { category: "invite", description: "Invite was deleted", icon: "❌" },

  THREAD_CREATE: { category: "thread", description: "Thread was created", icon: "🧵" },
  THREAD_DELETE: { category: "thread", description: "Thread was deleted", icon: "🗑️" },
  THREAD_UPDATE: { category: "thread", description: "Thread was updated", icon: "✏️" },
  THREAD_MEMBER_ADD: { category: "thread", description: "Member joined thread", icon: "➕" },
  THREAD_MEMBER_REMOVE: { category: "thread", description: "Member left thread", icon: "➖" },

  REACTION_ADD: { category: "reaction", description: "Reaction was added", icon: "❤️" },
  REACTION_REMOVE: { category: "reaction", description: "Reaction was removed", icon: "💔" },
  REACTION_REMOVE_ALL: { category: "reaction", description: "All reactions were removed", icon: "🧼" },

  COMMAND_USE: { category: "interaction", description: "Our bot's slash command was used", icon: "🤖" },
  SLASH_COMMAND_USE: { category: "interaction", description: "External bot slash command (e.g., /bump, /ban)", hint: "Use Bot Command filters to detect specific bots and success/failure", icon: "/" },
  SLASH_COMMAND_RESPONSE: { category: "interaction", description: "External bot command response with result (embed loaded)", hint: "Triggers when bot edits its response to add the result embed - best for detecting success/failure", icon: "📣" },
  BUTTON_CLICK: { category: "interaction", description: "Button was clicked", icon: "🖱️" },
  MODAL_SUBMIT: { category: "interaction", description: "Modal was submitted", icon: "📝" },
  SELECT_MENU_USE: { category: "interaction", description: "Select menu was used", icon: "📋" },
  CONTEXT_MENU_USE: { category: "interaction", description: "Context menu command was used", icon: "🧭" },
  AUTOCOMPLETE_USE: { category: "interaction", description: "Autocomplete was triggered", icon: "✨" },

  SCHEDULED_EVENT_CREATE: { category: "event", description: "Scheduled event was created", icon: "🆕" },
  SCHEDULED_EVENT_DELETE: { category: "event", description: "Scheduled event was deleted", icon: "🗑️" },
  SCHEDULED_EVENT_UPDATE: { category: "event", description: "Scheduled event was updated", icon: "✏️" },
  SCHEDULED_EVENT_USER_ADD: { category: "event", description: "User subscribed to scheduled event", icon: "➕" },
  SCHEDULED_EVENT_USER_REMOVE: { category: "event", description: "User unsubscribed from scheduled event", icon: "➖" },

  GITHUB_PUSH: { category: "github", description: "Code was pushed to a repository", icon: "⬆️" },
  GITHUB_PULL_REQUEST: { category: "github", description: "Pull request was opened, closed, or merged", icon: "🔀" },
  GITHUB_ISSUES: { category: "github", description: "Issue was opened, closed, or updated", icon: "🐛" },
  GITHUB_ISSUE_COMMENT: { category: "github", description: "Comment was added to an issue or pull request", icon: "💬" },
  GITHUB_RELEASE: { category: "github", description: "A release was published", icon: "🚀" },
  GITHUB_STAR: { category: "github", description: "Repository was starred or unstarred", icon: "⭐" },
  GITHUB_FORK: { category: "github", description: "Repository was forked", icon: "🍴" },
  GITHUB_WORKFLOW_RUN: { category: "github", description: "GitHub Actions workflow completed", icon: "⚙️" },
  GITHUB_WORKFLOW_JOB: { category: "github", description: "A GitHub Actions workflow job changed status", icon: "🧪" },
  GITHUB_CHECK_RUN: { category: "github", description: "A check run completed (e.g. CI, Cloudflare Pages)", icon: "✅" },
  GITHUB_CHECK_SUITE: { category: "github", description: "A check suite completed", icon: "📋" },
  GITHUB_DEPLOYMENT_STATUS: { category: "github", description: "A deployment status changed (e.g. Cloudflare Pages deploy)", icon: "🚢" },
};

export function formatDiscordEventTypeLabel(eventType) {
  const input = String(eventType || "").trim();
  if (!input) return "Discord event";
  return input
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getDiscordCategoryMeta(categoryKey) {
  const key = String(categoryKey || "").trim().toLowerCase();
  return DISCORD_EVENT_CATEGORIES[key] || DEFAULT_CATEGORY_META;
}

export function getDiscordEventTypeMeta(eventType, options = {}) {
  const normalizedType = String(eventType || "").trim().toUpperCase();
  const eventMeta = normalizedType ? DISCORD_EVENT_TYPES[normalizedType] : null;

  const fallbackCategory = String(options.fallbackCategory || DEFAULT_CATEGORY_KEY)
    .trim()
    .toLowerCase();

  if (eventMeta) {
    const categoryMeta = getDiscordCategoryMeta(eventMeta.category);
    return {
      value: normalizedType,
      category: eventMeta.category,
      categoryMeta,
      description: eventMeta.description || formatDiscordEventTypeLabel(normalizedType),
      hint: eventMeta.hint || null,
      icon: eventMeta.icon || categoryMeta.icon,
      color: categoryMeta.color,
    };
  }

  const categoryMeta = getDiscordCategoryMeta(fallbackCategory);
  return {
    value: normalizedType || "",
    category: fallbackCategory,
    categoryMeta,
    description: normalizedType ? formatDiscordEventTypeLabel(normalizedType) : "Discord event",
    hint: null,
    icon: categoryMeta.icon,
    color: categoryMeta.color,
  };
}

export function getDiscordEventTypeOptions({ category } = {}) {
  const normalizedCategory = category ? String(category).trim().toLowerCase() : "";

  return Object.entries(DISCORD_EVENT_TYPES)
    .filter(([, eventMeta]) => !normalizedCategory || eventMeta?.category === normalizedCategory)
    .map(([value, eventMeta]) => {
      const meta = getDiscordEventTypeMeta(value);
      return {
        value,
        category: eventMeta.category,
        description: meta.description,
        icon: meta.icon,
        label: `${meta.icon} ${meta.description}`,
      };
    })
    .sort((a, b) => a.description.localeCompare(b.description));
}
