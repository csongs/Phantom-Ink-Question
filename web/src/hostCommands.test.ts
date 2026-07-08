// web/src/hostCommands.test.ts
import { describe, it, expect } from 'vitest';
import { buildClueCommands, CLUE_CMD_PREFIX } from './hostCommands';
import type { GroupedQuestion } from './groupPaste';

describe('buildClueCommands', () => {
  const tags: GroupedQuestion[] = [
    { group: 1, index: 2, text: '它會去哪裡？' },
    { group: 1, index: 1, text: '它存放在哪裡？' },
  ];

  it('emits "<prefix> <group> <index> <bopomofo>" sorted by group then index', () => {
    const cmds = buildClueCommands(
      [
        { question: '它會去哪裡？', reply: '地面。' },
        { question: '它存放在哪裡？', reply: '天空。' },
      ],
      tags,
    );
    expect(cmds).toEqual([
      `${CLUE_CMD_PREFIX} 1 1 ㄊㄧㄢˉㄎㄨㄥˉ`,
      `${CLUE_CMD_PREFIX} 1 2 ㄉㄧˋㄇㄧㄢˋ`,
    ]);
  });

  it('excludes the trailing 。 and joins bopomofo without spaces', () => {
    const cmds = buildClueCommands(
      [{ question: '它會去哪裡？', reply: '地面。' }],
      [{ group: 3, index: 1, text: '它會去哪裡？' }],
    );
    expect(cmds).toEqual([`${CLUE_CMD_PREFIX} 3 1 ㄉㄧˋㄇㄧㄢˋ`]);
    expect(cmds[0]).not.toContain('。');
    expect(cmds[0]).not.toMatch(/ㄉ.+\sㄇ/); // 注音之間無空格
  });

  it('skips questions without a tag and questions with empty replies', () => {
    const cmds = buildClueCommands(
      [
        { question: '它會去哪裡？', reply: '地面。' },
        { question: 'AI 額外挑的題？', reply: '某回答。' },
        { question: '它存放在哪裡？', reply: '' },
      ],
      tags,
    );
    expect(cmds).toEqual([`${CLUE_CMD_PREFIX} 1 2 ㄉㄧˋㄇㄧㄢˋ`]);
  });

  it('supports a custom prefix', () => {
    const cmds = buildClueCommands(
      [{ question: '它會去哪裡？', reply: '地面。' }],
      [{ group: 1, index: 1, text: '它會去哪裡？' }],
      '/mybot clue',
    );
    expect(cmds[0].startsWith('/mybot clue 1 1 ')).toBe(true);
  });
});
