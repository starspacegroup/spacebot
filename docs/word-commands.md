# Word commands: /define and /synonym

Two small built-in commands a server can switch on. Both are **off until the server turns them on**.

```
/define word:serendipity      a definition: up to three parts of speech, two senses each, with an example
/define word:ice cream        a short phrase works too
/synonym word:happy           words that mean the same
```

The reply is public, like `/oldest`. Anything that cannot be answered (an unknown word, a service that is down) is a private message to the person who asked.

## Turning them on

Dashboard → **Commands**, in the built-in list: press the switch on `/define` or `/synonym`. That writes a `built_in_command_overrides` row, and the command sync puts the command in the server within a minute. Anyone in the server can then use it. The Commands page's access settings (a permission level, or allowed and denied roles) work on them like on any built-in. Migration `0092` adds the two commands with `enabled = 0`.

The handler checks the switch itself too, so a server that turned a command off gets "not turned on in this server" even if Discord still shows the command for a while.

## Where the answers come from

- **/define**: Wiktionary's REST API (`en.wiktionary.org/api/rest_v1/page/definition/…`). English entries only, markup stripped, text under CC BY-SA, and the embed says so and links to the page. It answers in a fraction of a second and handles phrases. (dictionaryapi.dev was tried first. It was returning 502s and taking about four seconds, which does not fit inside Discord's three.)
- **/synonym**: Datamuse (`api.datamuse.com/words?rel_syn=…`). Few words have listed synonyms, so an empty answer falls back to "means like" and the title says "Words like". Names and phrases are dropped when the word is a single word.

Both are free and need no key. Cloudflare may cache a repeat word at the edge for a day.

## Things that matter

- **Nothing is stored**: not the word and not who asked. The lookup is made from our server, so the services see SpaceBot, not the member.
- **Limits.** One member gets 12 lookups a minute across both commands (`consumeQuota`, group `word-lookup`). Each lookup is cut off after 2.2 seconds, because Discord wants an answer in three.
- **The word** is one word or a short phrase of letters, spaces, hyphens and apostrophes, at most 40 characters. Anything else is refused before any request goes out.
- **Third-party text** goes only into an embed, with all mentions turned off, stripped of HTML and cut to Discord's limits.
- **If a service goes away**, the member sees "having trouble" or "did not answer in time" and nothing breaks. Swap the service in `src/lib/server/word-commands.ts`; the parsers are pure and tested.

## Adding another command of this kind

Add its name to `WORD_COMMANDS`, a lookup branch in `handleWordCommand`, a migration inserting the command with `enabled = 0` (copy 0092), and tests. The interactions route already sends every name in `WORD_COMMANDS` to the handler.
