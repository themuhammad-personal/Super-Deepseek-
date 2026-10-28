// Contract tests for the native WebView's pre-injection page-surface probe.
// This runs the exact JavaScript embedded in DeepSeekPageSurface.kt so an
// invalid selector/regex or an auth/chat classification regression fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HELPER = fs.readFileSync(
  path.join(here, '../../main/java/com/superdeepseek/app/DeepSeekPageSurface.kt'),
  'utf8'
);
const probeSource = HELPER.match(
  /internal val DEEPSEEK_PAGE_SURFACE_PROBE_JS = """([\\s\\S]*?)"""\\.trimIndent\\(\\)/
)?.[1];
assert.ok(probeSource, 'DEEPSEEK_PAGE_SURFACE_PROBE_JS must stay extractable for contract tests');
const PROBE = probeSource.trim();

function element({ id = '', className = '', type = '', src = '', title = '', ariaLabel = '', autocomplete = '' } = {}) {
  const attrs = {
    src,
    title,
    'aria-label': ariaLabel,
    autocomplete,
  };
  return {
    id,
    className,
    type,
    getAttribute: (name) => attrs[name] ?? null,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
  };
}

function runProbe({
  pathName = '/',
  bodyText = '',
  challengeNodes = [],
  composerNodes = [],
  fields = [],
  controls = [],
} = {}) {
  const document = {
    body: { innerText: bodyText },
    querySelectorAll(selector) {
      if (selector.includes('iframe[src]')) return challengeNodes;
      if (selector.includes('textarea#chat-input')) return composerNodes;
      if (selector === 'input, textarea') return fields;
      if (selector === 'button, [role="button"], a') return controls;
      return [];
    },
  };
  const window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  return vm.runInNewContext(PROBE, { window, document, location: { pathname: pathName } });
}

test('a DeepSeek sign-in route is left untouched', () => {
  assert.equal(runProbe({ pathName: '/sign_in' }), 'auth');
});

test('an email/password/OTP field is treated as authentication', () => {
  assert.equal(runProbe({ fields: [element({ type: 'email' })] }), 'auth');
  assert.equal(runProbe({ fields: [element({ type: 'password' })] }), 'auth');
  assert.equal(runProbe({ fields: [element({ autocomplete: 'one-time-code' })] }), 'auth');
});

test('the first login screen is detected even before an input appears', () => {
  assert.equal(runProbe({
    bodyText: 'Sign in or Continue with Google',
    controls: [element()],
  }), 'auth');
});

test('a visible CAPTCHA takes precedence over a chat-shaped page', () => {
  assert.equal(runProbe({
    challengeNodes: [element({ src: 'https://newassets.hcaptcha.com/captcha/v1/check' })],
    composerNodes: [element()],
  }), 'auth');
});

test('the real chat composer allows engine injection', () => {
  assert.equal(runProbe({ composerNodes: [element()] }), 'chat');
});

test('unknown/loading pages fail closed', () => {
  assert.equal(runProbe({ bodyText: 'Welcome' }), 'loading');
});
