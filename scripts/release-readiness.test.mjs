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
  assert.ok(match[0].includes('inputs.publish == true') && match[0].includes('refs/heads/main'));
});

test('published release carries a source archive and SHA-256 from the exact release commit', () => {
  const sourceStart = workflow.indexOf('- name: Package source archive for the exact release commit');
  const actionStart = workflow.indexOf('- uses: softprops/action-gh-release@v3', sourceStart);
  assert.ok(sourceStart >= 0 && actionStart > sourceStart, 'release source archive step must run before publication');
  const sourceStep = workflow.slice(sourceStart, actionStart);
  assert.ok(sourceStep.includes('git archive --format=zip'));
  assert.ok(sourceStep.includes('"$GITHUB_SHA"'), 'source archive must match the commit tested and built by this workflow');
  assert.ok(sourceStep.includes('sha256sum "$SOURCE_ARCHIVE"'), 'source archive must include a SHA-256 sidecar');
  const releaseStart = workflow.indexOf('  release:');
  const releaseBlock = workflow.slice(releaseStart, actionStart);
  assert.ok(releaseBlock.includes('super-deepseek-source-v*.zip'));
  assert.ok(releaseBlock.includes('super-deepseek-source-v*.zip.sha256'));
  assert.ok(releaseBlock.includes('**Exact source bundle:**'), 'release notes must point to the matching source asset');
});
test('published release still requires permanent signing material, never a test key', () => {
  assert.match(workflow, /Prepare permanent release signing key[\s\S]*?BDS_KEYSTORE: \$\{\{ secrets\.BDS_KEYSTORE \}\}/);
  assert.match(workflow, /needs:\s*\[build-apk, android-instrumented-tests\]/);
  assert.match(workflow, /for name in BDS_KEYSTORE BDS_KEYSTORE_PASSWORD BDS_KEY_ALIAS BDS_KEY_PASSWORD/);
});

test('trusted publishing refs protect the permanent signer and treat tags as data', () => {
  const trustedPublishCondition = "if: (github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))) || (github.event_name == 'workflow_dispatch' && inputs.publish == true && github.ref == 'refs/heads/main')";

  const permanentKeyStart = workflow.indexOf('- name: Prepare permanent release signing key');
  const temporaryKeyStart = workflow.indexOf('- name: Prepare temporary signing key', permanentKeyStart);
  const permanentKey = workflow.slice(permanentKeyStart, temporaryKeyStart);
  assert.ok(permanentKeyStart >= 0 && temporaryKeyStart > permanentKeyStart && permanentKey.includes(trustedPublishCondition),
    'permanent signing must independently enforce the trusted-event/ref condition');

  const apkGateStart = workflow.indexOf('- name: Gate publishable APK identity, checksum, signature, and sandbox');
  const uploadApkStart = workflow.indexOf('- name: Upload APK Artifact', apkGateStart);
  const apkGate = workflow.slice(apkGateStart, uploadApkStart);
  assert.ok(apkGateStart >= 0 && uploadApkStart > apkGateStart && apkGate.includes(trustedPublishCondition),
    'the APK gate must independently enforce the trusted-event/ref condition');

  const releaseStart = workflow.indexOf('  release:');
  const releaseJob = workflow.slice(releaseStart);
  assert.ok(releaseStart >= 0 && releaseJob.includes(trustedPublishCondition),
    'the release job itself must block PR and untrusted-ref publication');
  assert.ok(workflow.includes('permissions:' + String.fromCharCode(10) + '  contents: read'),
    'build and test jobs must receive only read access to repository contents');
  assert.ok(releaseJob.includes('permissions:' + String.fromCharCode(10) + '      contents: write'),
    'write access must be scoped to the release-publishing job');

  const historyGuardStart = workflow.indexOf('- name: Verify release commit is on trusted main history');
  const historyGuardEnd = workflow.indexOf('- name: Prepare permanent release signing key', historyGuardStart);
  const historyGuard = workflow.slice(historyGuardStart, historyGuardEnd);
  assert.ok(historyGuardStart >= 0 && historyGuardEnd > historyGuardStart && historyGuard.includes('git merge-base --is-ancestor "$GITHUB_SHA" FETCH_HEAD'),
    'tag/manual release history must be checked before secrets are exposed');

  const releaseConfigStart = workflow.indexOf('- id: rel_cfg');
  const releaseActionStart = workflow.indexOf('- uses: softprops/action-gh-release@v3', releaseConfigStart);
  const releaseConfig = workflow.slice(releaseConfigStart, releaseActionStart);
  assert.ok(releaseConfigStart >= 0 && releaseActionStart > releaseConfigStart, 'release configuration step must exist');
  assert.ok(releaseConfig.includes('if [[ "$GITHUB_REF" == refs/tags/v* ]]'),
    'tag checks must use environment data instead of interpolating ref text into shell source');
  assert.ok(!releaseConfig.includes('github.ref') && !releaseConfig.includes('github.ref_name'),
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
