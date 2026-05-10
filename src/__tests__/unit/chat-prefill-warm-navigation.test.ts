/**
 * v8 fix — Tasks 页"新建任务"跳到 /chat?prefill=… 时输入框必须真的回填
 * prefill 文本。Pre-fix 有两层独立 staleness：
 *
 *   1. `src/app/chat/page.tsx` 用 `useMemo([])` 读 `window.location.search`，
 *      只在 mount 那一次执行；如果 /chat 已经挂着 (warm 导航 / 浏览器
 *      back-forward / router.replace) 再换 ?prefill=…，缓存值不更新。
 *
 *   2. `src/components/chat/MessageInput.tsx` 用 `useState(() =>
 *      initialValue || draft)` 只在 mount 时读 `initialValue` prop；
 *      之后即使父组件把新 prefill 喂给 prop，textarea 也不动。
 *
 * 修法：(1) chat/page.tsx 拆出内层组件、外层 export 包 Suspense，
 *       内层用 `useSearchParams()` 读 prefill —— React 会在 URL 变化时
 *       自然 re-render；(2) MessageInput 加一个 `useEffect`，
 *       检测到 `initialValue` prop 真正变化 (相对 ref 跟踪的上次值) 且
 *       新值非空时调 `setInputValue(initialValue)` —— 跟 mount 时
 *       "prefill 战胜 draft" 的优先级一致。
 *
 * 这个文件是 source-grep 契约：钉死两层修复都不被未来重构默默退回
 * 静态读取。无需 React Testing Library 也能跑。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CHAT_PAGE = readFileSync(
  path.resolve(__dirname, '../../app/chat/page.tsx'),
  'utf-8',
);
const MESSAGE_INPUT = readFileSync(
  path.resolve(__dirname, '../../components/chat/MessageInput.tsx'),
  'utf-8',
);

describe('chat/page.tsx prefill must be reactive to URL changes', () => {
  it('imports Suspense from react and useSearchParams from next/navigation', () => {
    assert.match(
      CHAT_PAGE,
      /from\s+['"]react['"];?\s*(?:\/\/.*)?$|import[^;]*\bSuspense\b[^;]*from\s+['"]react['"]/m,
      'chat/page.tsx must import Suspense (needed for useSearchParams in App Router)',
    );
    assert.match(
      CHAT_PAGE,
      /import\s*\{[^}]*\buseSearchParams\b[^}]*\}\s*from\s+['"]next\/navigation['"]/,
      'chat/page.tsx must import useSearchParams from next/navigation — `useMemo([])` reading `window.location.search` is the pre-fix pattern that ignored warm-navigation URL changes',
    );
  });

  it('does NOT use the pre-fix `useMemo([])` + window.location.search pattern for prefill', () => {
    // The exact regression: a useMemo with an empty deps array that
    // reads window.location.search for the prefill query param. That
    // freezes prefillText to its first-mount value.
    assert.doesNotMatch(
      CHAT_PAGE,
      /useMemo\(\s*\(\)\s*=>\s*\{[\s\S]*?window\.location\.search[\s\S]*?prefill[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
      'chat/page.tsx must NOT read prefill via `useMemo([])` over window.location.search — that pattern caches the URL forever and breaks warm navigation. Use `useSearchParams().get("prefill")` inside a Suspense-wrapped inner component.',
    );
  });

  it('default export wraps the body in <Suspense> so useSearchParams is legal', () => {
    // The default export must mount a Suspense boundary; the inner
    // function (where useSearchParams lives) renders inside it.
    const exportBlock = CHAT_PAGE.match(/export\s+default\s+function\s+\w+[\s\S]*?\n\}/);
    assert.ok(exportBlock, 'chat/page.tsx must have a default-exported function');
    assert.match(
      exportBlock![0],
      /<Suspense\b[\s\S]*?>[\s\S]*?<\/Suspense>/,
      'the default export must mount a <Suspense> boundary so useSearchParams() inside the inner component does not throw under static prerender',
    );
  });

  it('reads prefill via searchParams.get("prefill") (the reactive path)', () => {
    assert.match(
      CHAT_PAGE,
      /searchParams\.get\(\s*['"]prefill['"]\s*\)/,
      'chat/page.tsx must call `searchParams.get("prefill")` — that is what makes prefill react to URL changes after mount',
    );
  });
});

describe('MessageInput initialValue prop must propagate after mount (warm-navigation sync)', () => {
  it('declares a ref that tracks the last adopted initialValue', () => {
    // The fix uses a `useRef` to record the last initialValue we
    // adopted; the effect compares against this ref to decide whether
    // the prop actually changed. Without this guard the effect would
    // re-adopt prefill every time the user types and the parent
    // re-renders with the same prop.
    assert.match(
      MESSAGE_INPUT,
      /const\s+adoptedInitialValueRef\s*=\s*useRef\b/,
      'MessageInput must declare `adoptedInitialValueRef = useRef(initialValue)` to track the last adopted prefill — without it the effect would clobber user typing on every parent re-render',
    );
  });

  it('has a useEffect that adopts a changed `initialValue` by calling setInputValue', () => {
    // Brace-balanced extraction of the useEffect block whose deps
    // include initialValue + setInputValue. Asserts the body calls
    // setInputValue(initialValue) inside an `initialValue !==
    // adoptedInitialValueRef.current` guard.
    const useEffectBlocks = MESSAGE_INPUT.match(
      /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[[^\]]*initialValue[^\]]*setInputValue[^\]]*\]\s*\)/g,
    );
    assert.ok(
      useEffectBlocks && useEffectBlocks.length >= 1,
      'MessageInput must have a useEffect with deps array containing both `initialValue` and `setInputValue`',
    );
    const adoptionEffect = useEffectBlocks!.find((block) =>
      /adoptedInitialValueRef\.current/.test(block) &&
      /setInputValue\(\s*initialValue\s*\)/.test(block),
    );
    assert.ok(
      adoptionEffect,
      'one of the matching useEffects must compare `initialValue !== adoptedInitialValueRef.current` and call `setInputValue(initialValue)` — that is the warm-navigation prefill adoption path',
    );
  });

  it('updates the ref every time the prop is observed (so a future re-arrival of the same value is treated as a fresh transition)', () => {
    // The fix has two assignment sites for adoptedInitialValueRef.current:
    //   - inside the "adopt" branch (after setInputValue)
    //   - inside the "prop went back to empty" branch (reset)
    // Both keep the ref in sync with what we last observed; a regression
    // that drops the empty-reset branch would leave the ref pointing
    // at the previous prefill forever, so re-clicking 新建任务 with
    // the same prefill text after navigating away would silently no-op.
    const refAssignments = MESSAGE_INPUT.match(
      /adoptedInitialValueRef\.current\s*=/g,
    );
    assert.ok(
      refAssignments && refAssignments.length >= 2,
      `MessageInput must assign adoptedInitialValueRef.current at least twice (adopt branch + empty-reset branch) — found ${refAssignments?.length ?? 0}. Without the empty-reset branch the ref stays pinned to the old prefill and re-clicks of 新建任务 with the same text are silently dropped.`,
    );
  });
});
