// web/src/hostCommands.ts
//
// BOT clue command builder — the single source of truth for the
// `/ghostink clue 題目id:... 題組:... 選項:... 注音:...` format.
// If the BOT changes the parameter syntax, only this file needs updating.
//
// R8: normalizeQuestion (from groupPaste) is the single normalization used for
// bank matching. The local `normalize()` here stripped only ONE trailing ？
// (`[？?]$`), so a question like "真的嗎？？" failed to match and silently
// dropped its clue command — now gone.
import { toBopomofoCells } from './bopomofo';
import { normalizeQuestion } from './groupPaste';

export interface ClueParams {
  /** Command prefix without leading slash, e.g. 'ghostink' or 'phantomink'. */
  prefix: string;
  /** Question-set id the BOT uses to look up this puzzle. */
  questionId: string;
  /** Group number (1-based). */
  group: number;
  /** Option index within the group (1-based). */
  option: number;
  /** Bopomofo string: toBopomofoCells(reply).join(''). */
  zhuyin: string;
}

/** Build a single clue-command string in named-parameter format. */
export function buildClueCommand(p: ClueParams): string {
  return `/${p.prefix} clue 題目id:${p.questionId} 題組:${p.group} 選項:${p.option} 注音:${p.zhuyin}`;
}

/**
 * Build clue commands for every question that has a matching group tag,
 * sorted by (group, option). Uses the new named-parameter format.
 *
 * Questions whose reply has no bopomofo (non-Han reply) are skipped.
 * The caller provides the questionId and prefix.
 */
export function buildClueCommands(
  questions: { question: string; reply: string }[],
  tags: { group: number; index: number; text: string }[],
  questionId: string,
  prefix = 'ghostink',
): string[] {
  const tagByNorm = new Map(
    tags.map((t) => [normalizeQuestion(t.text), { group: t.group, option: t.index }]),
  );

  const rows: { group: number; option: number; zhuyin: string }[] = [];
  for (const q of questions) {
    const tag = tagByNorm.get(normalizeQuestion(q.question));
    if (!tag) continue;
    const zhuyin = toBopomofoCells(q.reply).join('');
    if (!zhuyin) continue;
    rows.push({ group: tag.group, option: tag.option, zhuyin });
  }

  rows.sort((a, b) => a.group - b.group || a.option - b.option);

  return rows.map((r) =>
    buildClueCommand({ prefix, questionId, group: r.group, option: r.option, zhuyin: r.zhuyin }),
  );
}
