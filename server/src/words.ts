import type { WordOption } from '@draw-guess/shared';
import { WORD_BANK } from './wordBank';

/** 从词库随机抽 count 个不在 exclude 中的词;词库耗尽时允许重复 */
export function pickWords(count: number, exclude: Set<string>, rng: () => number = Math.random): WordOption[] {
  let pool = WORD_BANK.filter((w) => !exclude.has(w.text));
  if (pool.length < count) pool = [...WORD_BANK];
  const picked: WordOption[] = [];
  const candidates = [...pool];
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const idx = Math.floor(rng() * candidates.length);
    picked.push(candidates[idx]);
    candidates.splice(idx, 1);
  }
  return picked;
}

/** 规范化猜词输入:去空白、小写(兼容英文字符词) */
export function normalizeGuess(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

export type GuessJudge = 'correct' | 'close' | 'wrong';

export function judgeGuess(guess: string, answer: string): GuessJudge {
  const g = normalizeGuess(guess);
  const a = normalizeGuess(answer);
  if (!g) return 'wrong';
  if (g === a) return 'correct';
  if (g.includes(a) || a.includes(g)) return 'close';
  return 'wrong';
}

/** 生成猜词端可见的掩码提示;revealedIndex 处的字明示,其余为「＿」 */
export function maskWord(word: string, revealedIndex: number | null): string {
  const chars = [...word];
  return chars.map((c, i) => (i === revealedIndex ? c : '＿')).join('');
}
