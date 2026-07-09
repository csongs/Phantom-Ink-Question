// web/src/hostCommands.test.ts
import { describe, it, expect } from 'vitest';
import { buildClueCommand, buildClueCommands } from './hostCommands';

describe('buildClueCommand', () => {
  it('builds the standard ghostink format', () => {
    const cmd = buildClueCommand({
      prefix: 'ghostink',
      questionId: '5',
      group: 4,
      option: 1,
      zhuyin: 'ㄐㄧㄢˉㄔㄠˇ',
    });
    expect(cmd).toBe('/ghostink clue 題目id:5 題組:4 選項:1 注音:ㄐㄧㄢˉㄔㄠˇ');
  });

  it('accepts phantomink prefix', () => {
    const cmd = buildClueCommand({
      prefix: 'phantomink',
      questionId: '5',
      group: 2,
      option: 3,
      zhuyin: 'ㄉㄧˋㄇㄧㄢˋ',
    });
    expect(cmd).toBe('/phantomink clue 題目id:5 題組:2 選項:3 注音:ㄉㄧˋㄇㄧㄢˋ');
  });

  it('accepts a custom prefix string', () => {
    const cmd = buildClueCommand({
      prefix: 'mybot',
      questionId: '7',
      group: 1,
      option: 1,
      zhuyin: 'ㄎㄜˉㄌㄧㄢˊ',
    });
    expect(cmd).toBe('/mybot clue 題目id:7 題組:1 選項:1 注音:ㄎㄜˉㄌㄧㄢˊ');
  });

  it('handles non-numeric questionId', () => {
    const cmd = buildClueCommand({
      prefix: 'ghostink',
      questionId: 'A3',
      group: 1,
      option: 2,
      zhuyin: 'ㄘㄞˋ',
    });
    expect(cmd).toBe('/ghostink clue 題目id:A3 題組:1 選項:2 注音:ㄘㄞˋ');
  });
});

describe('buildClueCommands', () => {
  const tags = [
    { group: 1, index: 2, text: '它會去哪裡？' },
    { group: 1, index: 1, text: '它存放在哪裡？' },
  ];

  it('emits commands sorted by (group, option) in the new named-param format', () => {
    const cmds = buildClueCommands(
      [
        { question: '它會去哪裡？', reply: '地面。' },
        { question: '它存放在哪裡？', reply: '天空。' },
      ],
      tags,
      '5',
    );
    expect(cmds).toEqual([
      '/ghostink clue 題目id:5 題組:1 選項:1 注音:ㄊㄧㄢˉㄎㄨㄥˉ',
      '/ghostink clue 題目id:5 題組:1 選項:2 注音:ㄉㄧˋㄇㄧㄢˋ',
    ]);
  });

  it('excludes trailing 。 and joins bopomofo without spaces', () => {
    const cmds = buildClueCommands(
      [{ question: '它會去哪裡？', reply: '地面。' }],
      [{ group: 3, index: 1, text: '它會去哪裡？' }],
      '5',
    );
    expect(cmds[0]).toBe('/ghostink clue 題目id:5 題組:3 選項:1 注音:ㄉㄧˋㄇㄧㄢˋ');
    expect(cmds[0]).not.toContain('。');
    expect(cmds[0]).not.toMatch(/ㄉ.+\sㄇ/);
  });

  it('skips questions without a tag and questions with empty replies', () => {
    const cmds = buildClueCommands(
      [
        { question: '它會去哪裡？', reply: '地面。' },
        { question: 'AI 額外挑的題？', reply: '某回答。' },
        { question: '它存放在哪裡？', reply: '' },
      ],
      tags,
      '5',
    );
    expect(cmds).toEqual(['/ghostink clue 題目id:5 題組:1 選項:2 注音:ㄉㄧˋㄇㄧㄢˋ']);
  });

  it('supports a custom prefix', () => {
    const cmds = buildClueCommands(
      [{ question: '它會去哪裡？', reply: '地面。' }],
      [{ group: 1, index: 1, text: '它會去哪裡？' }],
      '5',
      'phantomink',
    );
    expect(cmds[0]).toBe('/phantomink clue 題目id:5 題組:1 選項:1 注音:ㄉㄧˋㄇㄧㄢˋ');
  });

  it('matches a question whose pasted form has multiple trailing ？ (R8 regression)', () => {
    // The previous local normalize only stripped ONE trailing ？, so
    // 「真的嗎？？」 failed to match the tag and silently produced no command.
    const tags = [{ group: 1, index: 1, text: '真的嗎？' }];
    const cmds = buildClueCommands(
      [{ question: '真的嗎？？', reply: '是的。' }],
      tags,
      '5',
    );
    expect(cmds).toEqual([
      '/ghostink clue 題目id:5 題組:1 選項:1 注音:ㄕˋㄉㄜ˙',
    ]);
  });
});
