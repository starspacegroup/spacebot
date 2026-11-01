# Set channel topic

A custom command (or any automation) can change a channel's topic with the **Set Channel Topic** action.

- **Channel:** leave empty to use the channel the command was run in, or pick one. It must be in your server.
- **Topic:** the new text, up to 1024 characters. Variables work, so a command with a text option can use `{option.text}`. Empty text clears the topic.

Who can run it is the command's own permission setting (see command access). Give a command like this Manage Channels as its default so only moderators can use it.

SpaceBot needs **Manage Channels** in the channel. If it lacks that, the command replies that it could not do it.

Discord allows only about two topic changes per channel every ten minutes. A third in that window fails with a message saying to try again shortly.

Event-based automations (not commands) apply the topic text as written; variables are only filled in for commands.
