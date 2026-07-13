// web/src/groupPaste.ts
//
// Parses pasted "第 N 組" question blocks and matches them against the
// question bank. Each parsed question carries a (group, index) tag that is
// later used to emit host commands like `/ghostink clue 1 3 <bopomofo>`.

export interface GroupedQuestion {
  group: number;
  /** 1-based position within the group. */
  index: number;
  text: string;
}

const GROUP_HEADER = /^第\s*([0-9０-９一二三四五六七八九十]+)\s*組/;

/** Leading list-numbering that some paste sources prepend, e.g. "1. " / "１、" / "(1) ". */
const LIST_PREFIX = /^[\(（]?[0-9０-９]+[\.\)）、．]\s*/;

const CN_NUMS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Parses "1" / "１" / "一" / "十" / "十二" / "二十" style group numbers. */
function parseGroupNumber(s: string): number {
  const half = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(half)) return Number(half);
  if (half === '十') return 10;
  if (half.length === 2 && half[0] === '十') return 10 + (CN_NUMS[half[1]] ?? NaN);
  if (half.length === 2 && half[1] === '十') return (CN_NUMS[half[0]] ?? NaN) * 10;
  return CN_NUMS[half] ?? NaN;
}

/** Normalization used for bank matching: strip spaces, unify ?→？, drop trailing ？. */
export function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, '').replace(/[?]/g, '？').replace(/？+$/, '');
}

export function parseGroupedQuestions(raw: string): {
  items: GroupedQuestion[];
  errors: string[];
} {
  const items: GroupedQuestion[] = [];
  const errors: string[] = [];
  const seenGroups = new Set<number>();
  let currentGroup = 0;
  let indexInGroup = 0;

  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;

    const m = line.match(GROUP_HEADER);
    if (m) {
      const g = parseGroupNumber(m[1]);
      if (!Number.isFinite(g)) {
        errors.push(`無法解析組編號：「${line}」`);
        continue;
      }
      if (seenGroups.has(g)) errors.push(`第 ${g} 組出現多次`);
      seenGroups.add(g);
      currentGroup = g;
      indexInGroup = 0;
      continue;
    }

    if (currentGroup === 0) {
      errors.push(`「${line}」出現在任何組標題之前，已略過`);
      continue;
    }
    indexInGroup++;
    items.push({ group: currentGroup, index: indexInGroup, text: line.replace(LIST_PREFIX, '') });
  }

  if (items.length === 0) errors.push('沒有解析到任何題目');

  // Same question in two groups would make the (group, index) tag ambiguous.
  const seenText = new Map<string, GroupedQuestion>();
  for (const it of items) {
    const key = normalizeQuestion(it.text);
    const prev = seenText.get(key);
    if (prev) {
      errors.push(`「${it.text}」同時出現在第 ${prev.group} 組與第 ${it.group} 組`);
    } else {
      seenText.set(key, it);
    }
  }

  return { items, errors };
}

/** Rebuilds "第 N 組" paste text from parsed groupTags — the inverse of
 *  parseGroupedQuestions(). Used to restore the paste textarea from saved
 *  state (e.g. when re-entering a setup screen after generation). */
export function rebuildPasteText(groupTags: GroupedQuestion[]): string {
  const lines: string[] = [];
  let currentGroup = 0;
  for (const tag of groupTags) {
    if (tag.group !== currentGroup) {
      lines.push(`第 ${tag.group} 組`);
      currentGroup = tag.group;
    }
    const text = tag.text.endsWith('？') || tag.text.endsWith('?') ? tag.text : `${tag.text}？`;
    lines.push(text);
  }
  return lines.join('\n');
}

export interface BankMatchResult {
  /** Questions found in the bank — bankQuestion is the bank's exact text. */
  matched: { bankQuestion: string; tag: GroupedQuestion }[];
  /** Questions not in the bank — become forced custom questions. */
  unmatched: GroupedQuestion[];
}

export function matchToBank(
  items: GroupedQuestion[],
  bank: readonly string[],
): BankMatchResult {
  const byNorm = new Map(bank.map((q) => [normalizeQuestion(q), q]));
  const matched: BankMatchResult['matched'] = [];
  const unmatched: GroupedQuestion[] = [];
  for (const it of items) {
    const bankQ = byNorm.get(normalizeQuestion(it.text));
    if (bankQ) matched.push({ bankQuestion: bankQ, tag: it });
    else unmatched.push(it);
  }
  return { matched, unmatched };
}
