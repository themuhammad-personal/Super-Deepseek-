import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [packageJson, gradle, workflow, readme, buildNotes, readiness] = await Promise.all([
  read('../package.json').then(JSON.parse),
  read('../android/app/build.gradle.kts'),
  read('../.github/workflows/build-and-release-apk.yml'),
  read('../README.md'),
  read('../BUILD-NOTES.md'),
  read('../docs/RELEASE-READINESS.md'),
]);

test('release application ID and version stay aligned with package metadata', () => {
  const applicationId = gradle.match(/applicationId\s*=\s*"([^"]+)"/)?.[1];
  const namespace = gradle.match(/namespace\s*=\s*"([^"]+)"/)?.[1];
  const versionName = gradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
  assert.equal(applicationId, 'com.superdeepseek.app');
  assert.equal(namespace, applicationId);
  assert.equal(versionName, packageJson.version);
});

test('release remains gated on APK build and the complete emulator matrix', () => {
  assert.match(workflow, /needs:\s*\[build-apk, android-instrumented-tests\]/);
  assert.match(workflow, /api-level:\s*\[30, 34, 35\]/);
  assert.match(workflow, /name: Android Emulator Tests \(API \$\{\{ matrix\.api-level \}\}\)/);
});

test('publishable APK gate verifies manifest, versionCode, checksum, signer, and sandbox payload', () => {
  const match = workflow.match(/- name: Gate publishable APK identity, checksum, signature, and sandbox([\s\S]*?)(?=\n      - name: Upload APK Artifact)/);
  assert.ok(match, 'publish-only artifact gate must exist before upload');
  const gate = match[1];
  for (const required of [
    'sha256sum --check "$APK_PATH.sha256"',
    'aapt dump badging "$APK_PATH"',
    'com.superdeepseek.app',
    'versionName',
    'versionCode',
    'assets/sandbox/rootfs.json',
    'libproot',
    'libtalloc',
    'EXPECTED_CERT_SHA256',
    '75ebff1ca33e27e8f14d98122dc5e6db811a1c77f37133b7bbbd24cd75ba3803',
    'apksigner verify --verbose --print-certs "$APK_PATH"',
  ]) assert.ok(gate.includes(required), `missing release invariant: ${required}`);
  assert.match(match[0], /if: \\(github\\.event_name == 'push'[\\s\\S]*inputs\\.publish == true && github\\.ref == 'refs\\/heads\\/main'\\)/);
});

test('published release still requires permanent signing material, never a test key', () => {
  assert.match(workflow, /Prepare permanent release signing key[\s\S]*?BDS_KEYSTORE: \$\{\{ secrets\.BDS_KEYSTORE \}\}/);
  assert.match(workflow, /needs:\s*\[build-apk, android-instrumented-tests\]/);
  assert.match(workflow, /for name in BDS_KEYSTORE BDS_KEYSTORE_PASSWORD BDS_KEY_ALIAS BDS_KEY_PASSWORD/);
});

test('trusted publishing refs protect the permanent signer and treat tags as data', () => {
  const trustedPublishCondition = "if: (github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))) || (github.event_name == 'workflow_dispatch' && inputs.publish == true && github.ref == 'refs/heads/main')";
  assert.equal(workflow.split(trustedPublishCondition).length - 1, 3,
    'permanent signing, APK gate, and release publishing must share trusted-event/ref rules');

  const releaseConfig = workflow.match(/- id: rel_cfg([\s\S]*?)(?=\n      - uses: softprops\/action-gh-release@v3)/)?.[1];
  assert.ok(releaseConfig, 'release configuration step must exist');
  assert.match(releaseConfig, /if \[\[ "\$GITHUB_REF" == refs\/tags\/v\* \]\]/);
  assert.doesNotMatch(releaseConfig, /github\.(?:ref|ref_name)/,
    'untrusted ref values must not be interpolated into shell source');
});
test('README and build notes do not freeze changing Chromium acceptance totals', () => {
  for (const [name, doc] of [['README.md', readme], ['BUILD-NOTES.md', buildNotes]]) {
    assert.doesNotMatch(doc, /\b\d+\s+(?:Generative UI |GenUI )?acceptance checks\b/i, name);
    assert.match(doc, /RELEASE-READINESS\.md/, name);
  }
});

test('release checklist covers every requested regression family and redaction policy', () => {
  for (const phrase of [
    'CAPTCHA', 'OTP', 'chat reply', 'restart/session restore', 'Rotation',
    'keyboard', 'Back', 'GenUI', 'Preview', 'Code', 'oversized files',
    'agent progress', 'Stop', 'Linux sandbox', 'MCP failure', 'Deep Research',
    'Bengali', 'RTL', '16 KB', 'SHA-256', 'certificate', 'Mandatory log redaction',
    'PASS', 'FAIL', 'BLOCKED', 'NOT TESTED',
  ]) assert.ok(readiness.toLowerCase().includes(phrase.toLowerCase()), `checklist is missing: ${phrase}`);
});
