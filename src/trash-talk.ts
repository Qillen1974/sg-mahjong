/**
 * Canned trash talk phrases for AI-standby players.
 * Keyed by game action context, returned randomly (~30% chance).
 */

const phrases: Record<string, string[]> = {
  pong: ['Too slow!', 'Mine!', "I'll take that!", 'Pong! 😏'],
  kong: ['Four of a kind!', 'Kong! 💪', 'Nobody can stop me!'],
  chow: ['Thanks, I needed that', "Don't mind if I do", 'Perfect fit!'],
  win: ['Hu! Pay up!', 'Better luck next round!', 'Too easy! 😎', 'Winner winner!'],
  selfWin: ['Self-drawn! Double pay!', 'Zi mo! 🎉', 'Drew it myself!'],
  discard: ['Here, have this', 'Who wants it?', 'Garbage', "Don't need this"],
  draw: ['Hmm...', 'Interesting...', 'Let me think...', 'Nice tile 👀'],
};

const TRIGGER_CHANCE = 0.3;

/**
 * Returns a random canned phrase for the given context ~30% of the time.
 * Returns null otherwise (to avoid being overwhelming).
 */
export function getTrashTalk(context: string): string | null {
  if (Math.random() > TRIGGER_CHANCE) return null;
  const pool = phrases[context];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
