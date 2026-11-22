/**
 * The topics `/topic` hands out. Fixed on purpose: nothing here comes from a user, so the bot
 * never repeats text a member chose. Keep them safe for any server: no politics, religion or
 * anything that needs a content warning.
 */

export const TOPIC_KINDS = ['debate', 'rather', 'what_if', 'food', 'life'] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

export const TOPICS: Record<TopicKind, string[]> = {
	debate: [
		'Is a hotdog a sandwich?',
		'Is cereal a soup?',
		'Does pineapple belong on pizza?',
		'Is a Pop-Tart a ravioli?',
		'Is water wet?',
		'Is a taco a sandwich?',
		'Is a straw one hole or two?',
		'Does the toilet paper roll over the top or under?',
		'Is it "soda", "pop" or "coke"?',
		'Is a cucumber a fruit?',
		'Is cold pizza better than hot pizza?',
		'Is a burrito a sandwich?',
		'Should ketchup go in the fridge?',
		'Is a donut a type of bagel?',
		'Are bananas better green or spotty?',
		'Is a waffle just a pancake with a grid?',
		'Is mint chocolate chip a good flavor?',
		'Is it a "sub", a "hoagie" or a "hero"?',
		'Is a gif said "jif" or "gif"?',
		'Do socks go on before pants or after?',
		'Is the tomato a fruit or a vegetable?',
		'Is breakfast food better at night?',
		'Does a hot dog count as a taco?',
		'Is cheese on a burger a requirement?',
		'Is soup a drink?',
	],
	rather: [
		'Would you rather fight one horse-sized duck or a hundred duck-sized horses?',
		'Would you rather always be ten minutes late or twenty minutes early?',
		'Would you rather lose your phone or your wallet for a week?',
		'Would you rather only eat sweet food or only salty food for a year?',
		'Would you rather be able to fly slowly or run very fast?',
		'Would you rather have no internet for a month or no music for a year?',
		'Would you rather speak every language or play every instrument?',
		'Would you rather always have to whisper or always have to shout?',
		'Would you rather live in a treehouse or a houseboat?',
		'Would you rather know the date you die or the cause?',
		'Would you rather have a rewind button or a pause button for your life?',
		'Would you rather be a famous actor or a famous inventor?',
		'Would you rather only be able to walk backwards or only sideways?',
		'Would you rather have a personal chef or a personal driver?',
		'Would you rather give up games or give up movies forever?',
		'Would you rather always be too hot or always be too cold?',
		'Would you rather explore space or the deep ocean?',
		'Would you rather have a dragon or a robot as a pet?',
		'Would you rather never use a keyboard again or never use a mouse again?',
		'Would you rather have unlimited snacks or unlimited sleep?',
		'Would you rather live in the past or the future?',
		'Would you rather have every dream come true or never have a nightmare?',
		'Would you rather have eyes that zoom or ears that hear very far?',
		'Would you rather be the funniest or the smartest person in the room?',
		'Would you rather start every day with a surprise or a plan?',
	],
	what_if: [
		'What if you woke up tomorrow able to talk to animals? Who is the first you call?',
		'If you could add one rule to every game ever made, what would it be?',
		'If you could have dinner with anyone from history, who and why?',
		'What would you do with a free day where nothing could go wrong?',
		'If you could master any skill overnight, what would it be?',
		'If a movie was made about your week, what would it be called?',
		'What would you name a pet octopus?',
		'If you could live inside any video game for a week, which one?',
		'What invention do you wish existed right now?',
		'If you had to teach a class on anything, what would it be?',
		'What would your superhero name be, and what is your weakness?',
		'If you could swap lives with a fictional character for a day, who?',
		'What is the first thing you would build on a deserted island?',
		'If every server had a mascot, what would ours be?',
		'What would you put in a time capsule for the year 3000?',
		'If you could uninvent one thing, what would it be?',
		'If you could instantly travel anywhere for one meal, where do you go?',
		'What would your perfect theme park ride be?',
		'If animals could vote, which would win?',
		'What would be the worst superpower to have at a party?',
		'If you could rename any day of the week, what would you call it?',
		'What would you do if the whole server won the lottery together?',
		'If your life had a soundtrack, what song plays when you walk in?',
		'What if gravity worked at half strength for a day?',
		'If you could ask a fortune teller one question, what is it?',
	],
	food: [
		'What is the best thing you can make in under ten minutes?',
		'What is your go-to comfort food?',
		'Which food do you think is overrated?',
		'What is the best sandwich you have ever had?',
		'What is a food you hated as a kid and love now?',
		'What would your last meal be?',
		'What is the best pizza topping, and what is the worst?',
		'Sweet or savory breakfast?',
		'What is the best snack for gaming?',
		'What is a cheap meal you could eat every day?',
		'What is the best thing to put on a baked potato?',
		'Which fast food place has the best fries?',
		'What is your favorite way to eat eggs?',
		'What is the best flavor of ice cream?',
		'What is a food combination people find weird but you love?',
		'What is the best soup?',
		'Which cuisine could you eat for the rest of your life?',
		'What is the best thing to order at a diner?',
		'Coffee, tea or neither?',
		'What is the best candy, and who would trade you for it?',
		'What is the best thing to cook on a rainy day?',
		'What is the best side dish?',
		'What is your favorite thing to bake or wish you could bake?',
		'What is the best cereal?',
		'What is the best use of leftover rice?',
	],
	life: [
		'What is something small that made you happy this week?',
		'What was the last thing you learned that surprised you?',
		'What is a habit you are glad you started?',
		'What is the best advice you ever got?',
		'What is a skill you want to learn this year?',
		'What is your favorite way to spend a rainy day?',
		'What is the best purchase you made for under twenty dollars?',
		'What is a place you would go back to in a heartbeat?',
		'What song have you had on repeat lately?',
		'What is a show or movie you can rewatch forever?',
		'What did you want to be when you grew up?',
		'What is your favorite game from when you were a kid?',
		'What is the most useful thing you own?',
		'Are you a morning person or a night owl?',
		'What is a tiny luxury you love?',
		'What is the best gift you have given or received?',
		'What is something you are looking forward to?',
		'What is the most underrated game you know?',
		'What do you do when you cannot sleep?',
		'What is a hobby you picked up by accident?',
		'What is the best thing about where you live?',
		'What is a book, game or show you would tell everyone to try?',
		'What is your favorite season, and why?',
		'What is a word or phrase you use too much?',
		'What is your favorite way to start a day off?',
	],
};

/**
 * A random topic, never the one shown last when there is a choice. `own` is the server's own
 * list: it joins the built-in topics, or replaces them when `customOnly` is on and it is not
 * empty. `random` is injectable so a test can pin the pick.
 */
export function pickTopic(
	kind: string | null | undefined,
	last: string | null = null,
	random: () => number = Math.random,
	own: string[] = [],
	customOnly = false
): string {
	const builtIn = (TOPIC_KINDS as readonly string[]).includes(kind ?? '')
		? TOPICS[kind as TopicKind]
		: Object.values(TOPICS).flat();
	// A kind is a built-in category, so asking for one means the built-in list.
	const kindAsked = (TOPIC_KINDS as readonly string[]).includes(kind ?? '');
	let pool = builtIn;
	if (own.length && !kindAsked) pool = customOnly ? own : [...builtIn, ...own];
	const choices = pool.length > 1 ? pool.filter((t) => t !== last) : pool;
	const i = Math.min(choices.length - 1, Math.floor(random() * choices.length));
	return choices[i];
}
