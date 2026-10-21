// Tests for bds/sd-files.js (on-device conversion of files the chat's upload refuses).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '../../main/bds-assets/bds/sd-files.js'), 'utf8');

function load(accept) {
  const listeners = [];
  const win = {
    TextDecoder, Blob, File, Response, DecompressionStream, Uint8Array, Promise, console,
    document: { documentElement: { lang: 'en' }, addEventListener: (t, f, c) => listeners.push([t, f, c]) },
    navigator: { language: 'en' },
    __sdNative: { _acceptsFile: (acc, f) => (acc || '').split(',').map((s) => s.trim()).filter(Boolean).some((a) => f.name.toLowerCase().endsWith(a)) },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { F: win.__sdFiles, listeners };
}

// Minimal ZIP writer (deflate) — enough to build docx/xlsx/pptx/odt/epub fixtures.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries, store = false) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const data = store ? raw : zlib.deflateRawSync(raw);
    const nb = Buffer.from(name, 'utf8'), crc = crc32(raw), method = store ? 0 : 8;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, data); centrals.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const file = (buf, name, type = '') => new File([buf], name, { type });

test('docx: paragraphs, tabs and tables become plain text', async () => {
  const { F } = load();
  const doc = '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/><w:t>world &amp; co</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>';
  const r = await F.extract(file(zip({ '[Content_Types].xml': '<x/>', 'word/document.xml': doc }), 'a.docx'));
  assert.equal(r.kind, 'Word document');
  assert.equal(r.text, 'Hello\tworld & co\nSecond');
});

test('xlsx: shared strings, numbers and inline strings become TSV per sheet, columns kept', async () => {
  const { F } = load();
  const r = await F.extract(file(zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Sales" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Qty</t></si><si><r><t>Te</t></r><r><t>a</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>42</v></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>note</t></is></c></row></sheetData></worksheet>',
  }), 'b.xlsx'));
  assert.equal(r.kind, 'spreadsheet');
  assert.equal(r.text, '## Sheet: Sales\nItem\tQty\nTea\t\t42\n\tnote');
});

test('pptx: slides in numeric order (slide10 after slide2)', async () => {
  const { F } = load();
  const s = (t) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  const r = await F.extract(file(zip({ 'ppt/presentation.xml': '<x/>', 'ppt/slides/slide10.xml': s('Ten'), 'ppt/slides/slide2.xml': s('Two'), 'ppt/slides/slide1.xml': s('One') }), 'c.pptx'));
  assert.equal(r.text, '## Slide 1\nOne\n\n## Slide 2\nTwo\n\n## Slide 3\nTen');
});

test('odt and epub (spine order, html stripped)', async () => {
  const { F } = load();
  const odt = await F.extract(file(zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:text><text:h>Title</text:h><text:p>Body<text:s text:c="2"/>text</text:p></office:text>' }, true), 'd.odt'));
  assert.equal(odt.kind, 'OpenDocument');
  assert.equal(odt.text, 'Title\nBody  text');
  const ep = await F.extract(file(zip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    'OEBPS/book.opf': '<package><metadata><dc:title>My Book</dc:title></metadata><manifest><item id="b" href="ch2.xhtml"/><item id="a" href="ch1.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OEBPS/ch1.xhtml': '<html><head><style>p{}</style></head><body><h1>One</h1><p>First</p></body></html>',
    'OEBPS/ch2.xhtml': '<html><body><p>Second</p></body></html>',
  }), 'e.epub'));
  assert.equal(ep.kind, 'e-book');
  assert.equal(ep.text, '# My Book\n\n# One\nFirst\n\nSecond');
});

test('generic archive: listing plus readable inner files; binaries and junk folders skipped', async () => {
  const { F } = load();
  const r = await F.extract(file(zip({ 'src/main.py': 'print("hi")\n', 'bin/app.exe': Buffer.from([0, 1, 2, 3, 0, 0, 9]), 'node_modules/x/index.js': 'junk', 'docs/': '' }), 'proj.zip'));
  assert.equal(r.kind, 'archive');
  assert.match(r.text, /# Archive: proj\.zip/);
  assert.match(r.text, /- src\/main\.py \(12 B\)/);
  assert.match(r.text, /## File: src\/main\.py\n```py\nprint\("hi"\)/);
  assert.doesNotMatch(r.text, /## File: bin\/app\.exe/);
  assert.doesNotMatch(r.text, /## File: node_modules/);
});

test('rtf, unknown text and opaque binary', async () => {
  const { F } = load();
  const rtf = await F.extract(file(Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello \\b bold\\b0\\par caf\\\'e9 \\u8211? done}'), 'f.rtf'));
  assert.equal(rtf.text, 'Hello bold\ncafé – done');
  const txt = await F.extract(file(Buffer.from('key = value\n'), 'settings.conf'));
  assert.equal(txt.kind, 'text');
  const bin = await F.extract(file(Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1]), Buffer.from('GLIBC_2.17 readable-string'), Buffer.from([0, 0])]), 'tool.bin'));
  assert.equal(bin.kind, 'binary');
  assert.match(bin.text, /First bytes \(hex\): 7f 45 4c 46/);
  assert.match(bin.text, /GLIBC_2\.17 readable-string/);
});

test('large text is split into noted parts at line breaks', async () => {
  const { F } = load();
  const line = 'x'.repeat(99) + '\n';
  const parts = F.partsOf('big.log', line.repeat(40000), 'text'); // 4,000,000 chars
  assert.equal(parts.length, 3);
  assert.deepEqual([...parts].map((p) => p.name), ['big.log.part1.txt', 'big.log.part2.txt', 'big.log.part3.txt']);
  const first = await parts[0].text();
  assert.match(first, /^\[big\.log — text, part 1 of 3\]\n\n/);
  assert.ok(first.endsWith('\n') || first.endsWith('x'));
  assert.equal(F.partsOf('small.md', 'hi', 'text')[0].name, 'small.md.txt');
});

test('convertAll: accepted files untouched, refused ones converted, audio/video refused with a note', async () => {
  const { F } = load();
  const pdf = file(Buffer.from('%PDF-1.4'), 'paper.pdf', 'application/pdf');
  const odt = file(zip({ mimetype: 'x', 'content.xml': '<text:p>Hi</text:p>' }, true), 'note.odt');
  const mp4 = file(Buffer.from('....'), 'clip.mp4', 'video/mp4');
  const r = await F.convertAll([pdf, odt, mp4], { accept: '.pdf,.txt' });
  assert.equal(r.files.length, 2);
  assert.equal(r.files[0], pdf);
  assert.equal(r.files[1].name, 'note.odt.txt');
  assert.equal(await r.files[1].text(), 'Hi');
  assert.ok(r.notes.some((n) => /clip\.mp4: audio and video are not supported/.test(n)));
  assert.ok(r.notes.some((n) => /note\.odt → read on device/.test(n)));
});

test('a capture-phase change listener is installed on the document', () => {
  const { listeners } = load();
  assert.ok(listeners.some(([type, , capture]) => type === 'change' && capture === true));
});
