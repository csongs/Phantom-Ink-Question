// web/src/hostCommands.ts
//
// Builds host-side bot commands from generated questions and their
// (group, index) tags. Reply bopomofo is joined without spaces and without
// the trailing 。 cell, e.g. `/ghostink clue 1 3 ㄐㄧㄢˉㄘㄞˋ`.
import { toBopomofoCells } from './bopomofo';
import { normalizeQuestion, type GroupedQuestion } from './groupPaste';

export const CLUE_CMD_PREFIX = '/ghostink clue';

export function buildClueCommands(
  questions: { question: string; reply: string }[],
  tags: GroupedQuestion[],
  prefix: string = CLUE_CMD_PREFIX,
): string[] {
  const tagByNorm = new Map(tags.map((t) => [normalizeQuestion(t.text), t]));
  const rows: { tag: GroupedQuestion; bpmf: string }[] = [];
  for (const q of questions) {
    const tag = tagByNorm.get(normalizeQuestion(q.question));
    if (!tag) continue; // AI 額外挑的題沒有編號，略過
    // toBopomofoCells 只轉漢字，句號「。」不會出現在結果裡
    const bpmf = toBopomofoCells(q.reply).join('');
    if (!bpmf) continue;
    rows.push({ tag, bpmf });
  }
  rows.sort((a, b) => a.tag.group - b.tag.group || a.tag.index - b.tag.index);
  return rows.map((r) => `${prefix} ${r.tag.group} ${r.tag.index} ${r.bpmf}`);
}
