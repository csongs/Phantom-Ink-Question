// web/src/toolsMenu.test.ts
//
// jsdom DOM tests for the 小工具 page (解謎小幫手 + 文字轉注音).
// 規則已搬到首頁第一項,故這裡不再含規則按鈕。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToolsMenu, renderRulesPage } from './toolsMenu';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mountTools(): { el: HTMLElement; onBack: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const onBack = vi.fn();
  renderToolsMenu(el, onBack);
  return { el, onBack };
}

describe('renderToolsMenu', () => {
  it('renders two tool buttons (solver, bpmf) — 規則 lives on the home page', () => {
    const { el } = mountTools();
    const buttons = el.querySelectorAll<HTMLButtonElement>('.pi-tool-btn');
    expect(buttons.length).toBe(2);
    const labels = Array.from(buttons).map((b) => b.textContent || '');
    expect(labels.some((l) => l.includes('解謎小幫手'))).toBe(true);
    expect(labels.some((l) => l.includes('文字轉注音'))).toBe(true);
    expect(labels.some((l) => l.includes('規則'))).toBe(false);
  });

  it('← 返回 button calls onBack (no reload)', () => {
    const { el, onBack } = mountTools();
    const back = el.querySelector<HTMLAnchorElement>('#pi-tools-back');
    expect(back).toBeTruthy();
    back?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('clicking 解謎小幫手 renders the solver tool page', () => {
    const { el } = mountTools();
    const solverBtn = Array.from(el.querySelectorAll<HTMLButtonElement>('.pi-tool-btn'))
      .find((b) => b.textContent?.includes('解謎小幫手'));
    expect(solverBtn).toBeTruthy();
    solverBtn?.click();
    expect(el.querySelector('.pi-solver-input')).toBeTruthy();
    expect(el.querySelector('.pi-solver-run')).toBeTruthy();
  });

  it('clicking 文字轉注音 renders the bopomofo converter', () => {
    const { el } = mountTools();
    const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('.pi-tool-btn'))
      .find((b) => b.textContent?.includes('文字轉注音'));
    expect(btn).toBeTruthy();
    btn?.click();
    expect(el.querySelector('.pi-bpmf-input')).toBeTruthy();
    expect(el.querySelector('.pi-bpmf-convert')).toBeTruthy();
  });

  it('each sub-tool has its own ← 返回 button that calls onBack', () => {
    const { el, onBack } = mountTools();
    const solverBtn = Array.from(el.querySelectorAll<HTMLButtonElement>('.pi-tool-btn'))
      .find((b) => b.textContent?.includes('解謎小幫手'));
    solverBtn?.click();
    const subBack = el.querySelector<HTMLAnchorElement>('#pi-tool-back');
    expect(subBack).toBeTruthy();
    subBack?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('bopomofo converter input/click conversion wires correctly', () => {
    const { el } = mountTools();
    const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('.pi-tool-btn'))
      .find((b) => b.textContent?.includes('文字轉注音'));
    btn?.click();
    const input = el.querySelector<HTMLTextAreaElement>('.pi-bpmf-input')!;
    const convert = el.querySelector<HTMLButtonElement>('.pi-bpmf-convert')!;
    const output = el.querySelector<HTMLElement>('.pi-bpmf-output')!;
    input.value = '音樂';
    convert.click();
    expect(output.textContent).toContain('ㄧ');
  });
});

describe('renderRulesPage (首頁第一項規則)', () => {
  it('renders 靈媒遊戲 title with ← 返回', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onBack = vi.fn();
    renderRulesPage(el, onBack);
    expect(el.querySelector('.pi-rules-body')?.textContent).toContain('靈媒遊戲');
    expect(el.querySelector('#pi-tool-back')).toBeTruthy();
    el.querySelector<HTMLAnchorElement>('#pi-tool-back')?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
