import { test } from "node:test";
import assert from "node:assert/strict";
import * as Doc from "../public/doc.js";
import * as Span from "../public/span.js";

// A selection across paragraphs (TOOLS-470): each block is its own editing area, so the editor keeps a selection of its
// own that starts in one block and ends in another. These are its rules, without the page.
const SCRIPT = "# Title\n\n## 1 · Hook\n\nFirst para one.\n\nSecond para two.\n\nThird para three.\n\n## 2 · Next\n\nFourth para four.\n";
const ids = (doc) => doc.blocks.map((b) => b.id);
const contents = (doc) => doc.blocks.map((b) => `${b.type}:${Doc.contentOf(b)}`);
const at = (doc, i, offset) => ({ id: doc.blocks[i].id, offset });

test("a selection inside one block is not a span; across blocks it is, in reading order", () => {
  const doc = Doc.parse(SCRIPT);
  assert.equal(Span.spanOf(doc, at(doc, 2, 1), at(doc, 2, 5)), null);
  const back = Span.spanOf(doc, at(doc, 4, 3), at(doc, 2, 6));
  assert.deepEqual(back, { from: at(doc, 2, 6), to: at(doc, 4, 3) });
});

test("the script's title is never part of a span: it starts at the next block", () => {
  const doc = Doc.parse(SCRIPT);
  assert.deepEqual(Span.spanOf(doc, at(doc, 0, 2), at(doc, 3, 4)), { from: at(doc, 1, 0), to: at(doc, 3, 4) });
  assert.equal(Span.spanOf(doc, at(doc, 0, 2), at(doc, 1, 0)), null, "only the title and the very start of the next block");
});

test("copy gives the words only, with a blank line between blocks", () => {
  const doc = Doc.parse("# T\n\n## Hook\n\nA **bold** word and [a link](https://example.com) here.\n\nNext line.\n");
  const span = Span.spanOf(doc, at(doc, 1, 0), at(doc, 3, 4));
  assert.equal(Span.spanCopy(doc, span), "Hook\n\nA bold word and a link here.\n\nNext");
  // Starting inside a paragraph: from there on, marks left out.
  const mid = Span.spanOf(doc, at(doc, 2, 4), at(doc, 3, 10));
  assert.equal(Span.spanCopy(doc, mid), "bold word and a link here.\n\nNext line.");
});

test("delete joins the ends into the first block; the blocks between go, section titles too", () => {
  const doc = Doc.parse(SCRIPT);
  const span = Span.spanOf(doc, at(doc, 2, 6), at(doc, 6, 7));
  const r = Span.replaceSpan(doc, span, "");
  assert.deepEqual(contents(r.doc), ["title:Title", "heading:1 · Hook", "para:First para four."]);
  assert.equal(r.doc.blocks[2].id, doc.blocks[2].id, "the first block keeps its id");
  assert.deepEqual(r.removed, ids(doc).slice(3, 7));
  assert.deepEqual(r.caret, { id: doc.blocks[2].id, offset: 6 });
  assert.equal(Doc.serialize(doc), SCRIPT, "the document passed in is not changed");
});

test("typing over the span puts the text at the join", () => {
  const doc = Doc.parse(SCRIPT);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, 6)), "X");
  assert.deepEqual(contents(r.doc).slice(2), ["para:First Xpara three.", "heading:2 · Next", "para:Fourth para four."]);
  assert.deepEqual(r.caret, { id: doc.blocks[2].id, offset: 7 });
});

test("the joined block keeps the first block's kind; selected from its very start it takes the last block's", () => {
  const doc = Doc.parse(SCRIPT);
  const fromHeading = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 2), at(doc, 2, 6)), "");
  assert.deepEqual(contents(fromHeading.doc).slice(1, 3), ["heading:1 para one.", "para:Second para two."]);
  const wholeHeading = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 0), at(doc, 2, 6)), "");
  assert.deepEqual(contents(wholeHeading.doc).slice(1, 3), ["para:para one.", "para:Second para two."]);
  assert.match(Doc.serialize(wholeHeading.doc), /^# Title\n\npara one\.\n\nSecond/);
  const intoHeading = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 4, 0), at(doc, 5, 2)), "");
  assert.deepEqual(contents(intoHeading.doc).slice(3, 6), ["para:Second para two.", "heading:· Next", "para:Fourth para four."]);
});

test("a heading that takes in text keeps it on one line; text with blank lines makes paragraphs", () => {
  const doc = Doc.parse(SCRIPT);
  const heading = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 2), at(doc, 2, 6)), "a\nb ");
  assert.equal(Doc.contentOf(heading.doc.blocks[1]), "1 a b para one.");
  const paras = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 3, 7)), "one\n\ntwo ");
  assert.deepEqual(contents(paras.doc).slice(2, 5), ["para:First one", "para:two para two.", "para:Third para three."]);
  assert.deepEqual(paras.caret, { id: paras.doc.blocks[3].id, offset: 4 });
});

test("Enter over a span splits at the join", () => {
  const doc = Doc.parse(SCRIPT);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 3, 7)), "", { split: true });
  assert.deepEqual(contents(r.doc).slice(2, 4), ["para:First ", "para:para two."]);
  assert.deepEqual(r.caret, { id: r.doc.blocks[3].id, offset: 0 });
});

test("bold and links cut by the span are settled: no lone marks, a link keeps its words that are left", () => {
  const doc = Doc.parse("# T\n\nOne **bold words** here.\n\nTwo [link words](https://example.com) end.\n");
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 11), at(doc, 2, 10)), "");
  assert.equal(Doc.contentOf(r.doc.blocks[1]), "One bold [words](https://example.com) end.");
  const whole = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 4), at(doc, 2, 38)), "");
  assert.equal(Doc.contentOf(whole.doc.blocks[1]), "One end.");
});

test("an edit whose settled marks would turn the line into another kind of block is refused", () => {
  const doc = Doc.parse("# T\n\n**- x** one\n\nTwo end.\n");
  assert.equal(Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 4), at(doc, 2, 4)), ""), null);
});

test("shots on removed blocks follow to the join, or to the next spoken paragraph when the join is not spoken", () => {
  const doc = Doc.parse(SCRIPT);
  const [, , p1, p2, p3, , p4] = ids(doc);
  const shots = [{ id: "B1", blockIds: [p1] }, { id: "B2", blockIds: [p2] }, { id: "B3", blockIds: [p2, p3] }, { id: "B4", blockIds: [p4] }];
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, 6)), "");
  assert.deepEqual(Span.followShots(r.doc, shots, r), [
    { id: "B2", blockIds: [p1], moved: true },
    { id: "B3", blockIds: [p1], moved: true },
  ]);
  // The join is a section title: the shots go to the next spoken paragraph.
  const h = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 2), at(doc, 3, 3)), "");
  assert.deepEqual(Span.followShots(h.doc, shots, h), [
    { id: "B1", blockIds: [p3], moved: true },
    { id: "B2", blockIds: [p3], moved: true },
    { id: "B3", blockIds: [p3], moved: true },
  ]);
});
