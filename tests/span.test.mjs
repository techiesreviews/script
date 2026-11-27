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

test("a paragraph selected from its very start into a section title becomes that title: its shots go to the next spoken paragraph", () => {
  // "## 20 · Next" loses only its "2": still a numbered, spoken part.
  const doc = Doc.parse(SCRIPT.replace("## 2 · Next", "## 20 · Next"));
  const [, , p1, p2, p3, , p4] = ids(doc);
  const shots = [{ id: "B1", blockIds: [p1] }, { id: "B2", blockIds: [p2] }, { id: "B3", blockIds: [p2, p3] }];
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 3, 0), at(doc, 5, 1)), "");
  assert.equal(Doc.blockById(r.doc, p2).type, "heading", "the joined block is the section title now");
  assert.deepEqual(Span.followShots(r.doc, shots, r), [
    { id: "B2", blockIds: [p4], moved: true },
    { id: "B3", blockIds: [p4], moved: true },
  ]);
});

test("lines folded away at the top are never part of a span: from the title it starts after them", () => {
  const doc = Doc.parse("# Title\n\n- Private production notes.\n\n---\n\n## 1 · Hook\n\nFirst para one.\n");
  const hidden = new Set([doc.blocks[1].id, doc.blocks[2].id]);
  const span = Span.spanOf(doc, at(doc, 0, 2), at(doc, 4, 5), { hidden });
  assert.deepEqual(span, { from: at(doc, 3, 0), to: at(doc, 4, 5) });
  assert.equal(Span.spanCopy(doc, span), "1 · Hook\n\nFirst");
  assert.equal(Span.spanOf(doc, at(doc, 0, 2), at(doc, 3, 0), { hidden }), null, "nothing left but the start of the next block");
  // Unfolded, they are text like any other.
  assert.deepEqual(Span.spanOf(doc, at(doc, 0, 2), at(doc, 4, 5)).from, at(doc, 1, 0));
});

test("a shared edit in a block the span touches, or one that adds or joins blocks, ends it; others leave it", () => {
  const doc = Doc.parse(SCRIPT);
  const span = Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, 3));
  const text = (i) => ({ type: "text", blockId: doc.blocks[i].id, at: 0, del: 0, ins: "New " });
  assert.equal(Span.spanTouched(doc, span, [text(2)]), true, "words put in before the span in its first block");
  assert.equal(Span.spanTouched(doc, span, [text(3)]), true, "inside it");
  assert.equal(Span.spanTouched(doc, span, [text(4)]), true, "in its last block");
  assert.equal(Span.spanTouched(doc, span, [text(6)]), false, "a block after it");
  assert.equal(Span.spanTouched(doc, span, [text(1)]), false, "a block before it");
  assert.equal(Span.spanTouched(doc, span, [{ type: "split", blockId: doc.blocks[6].id, at: 2, newId: "x" }]), true, "blocks added or joined");
  assert.equal(Span.spanTouched(doc, null, [text(2)]), false);
});

test("a drag whose far end has no words of the next block (the gap after its paragraph) is no span", () => {
  const doc = Doc.parse(SCRIPT);
  const down = Span.spanOf(doc, at(doc, 2, 6), at(doc, 3, 0));
  assert.equal(Span.spanFarEmpty(doc, down, at(doc, 3, 0)), true, "down into the gap: the start of the next block");
  const up = Span.spanOf(doc, at(doc, 3, 4), at(doc, 2, 15));
  assert.equal(Span.spanFarEmpty(doc, up, at(doc, 2, 15)), true, "up into the gap: the end of the block before");
  assert.equal(Span.spanFarEmpty(doc, down, at(doc, 2, 6)), false, "the press end may be anywhere");
  assert.equal(Span.spanFarEmpty(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 3, 1)), at(doc, 3, 1)), false, "one letter of the next block");
  assert.equal(Span.spanFarEmpty(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, 0)), at(doc, 4, 0)), false, "a whole block between");
});

test("marks are settled only when the joined block is a paragraph, as one-block edits do", () => {
  const doc = Doc.parse("# T\n\n- a **b** c\n\nNext words.\n");
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 7), at(doc, 2, 5)), "");
  assert.equal(Doc.contentOf(r.doc.blocks[1]), "- a **bwords.", "a list line keeps its literal marks");
});

test("whole paragraphs deleted or cut from their very start: their shots go to the next paragraph with words, never the emptied one", () => {
  const doc = Doc.parse(SCRIPT);
  const [, , p1, p2, p3, , p4] = ids(doc);
  const shots = [{ id: "B1", blockIds: [p1] }, { id: "B2", blockIds: [p2] }, { id: "B3", blockIds: [p2, p3] }];
  const end = Doc.contentOf(Doc.blockById(doc, p3)).length;
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 0), at(doc, 4, end)), "");
  assert.equal(Doc.contentOf(Doc.blockById(r.doc, p1)), "", "the first paragraph is left empty");
  assert.deepEqual(Span.followShots(r.doc, shots, r), [
    { id: "B1", blockIds: [p4], moved: true },
    { id: "B2", blockIds: [p4], moved: true },
    { id: "B3", blockIds: [p4], moved: true },
  ]);
});

test("typing over whole paragraphs from their very start, first key with no letters: the shots go to the next paragraph with words, as for Delete", () => {
  // Kept at the join, a shot would keep the Over of words now gone, which no word typed next can match: a later read of
  // the list would take it off the script (TOOLS-480 review round 2).
  const doc = Doc.parse(SCRIPT);
  const [, , p1, p2, p3, , p4] = ids(doc);
  const shots = [{ id: "B1", blockIds: [p1] }, { id: "B2", blockIds: [p2] }, { id: "B3", blockIds: [p2, p3] }];
  const end = Doc.contentOf(Doc.blockById(doc, p3)).length;
  for (const key of ["\"", "(", " "]) {
    const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 0), at(doc, 4, end)), key);
    assert.ok(r.typed > 0, `${JSON.stringify(key)} is put in`);
    assert.deepEqual(Span.followShots(r.doc, shots, r), [
      { id: "B1", blockIds: [p4], moved: true },
      { id: "B2", blockIds: [p4], moved: true },
      { id: "B3", blockIds: [p4], moved: true },
    ], `after ${JSON.stringify(key)} all three go to the next paragraph with words`);
  }
});

test("Enter over a span from a paragraph's very start: its shots go with the words to the new block, never the emptied one", () => {
  const doc = Doc.parse(SCRIPT);
  const [, , p1, p2, p3, , p4] = ids(doc);
  const shots = [{ id: "B1", blockIds: [p1] }, { id: "B2", blockIds: [p2] }, { id: "B3", blockIds: [p3] }];
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 0), at(doc, 4, 6)), "", { split: true });
  assert.equal(Doc.contentOf(Doc.blockById(r.doc, p1)), "", "the left part keeps the first paragraph's id, empty");
  assert.deepEqual(Span.followShots(r.doc, shots, r), [
    { id: "B1", blockIds: [r.caret.id], moved: true },
    { id: "B2", blockIds: [r.caret.id], moved: true },
    { id: "B3", blockIds: [r.caret.id], moved: true },
  ]);
  // To the very end of the last paragraph: both parts are empty, so the shots go to the next paragraph with words.
  const end = Doc.contentOf(Doc.blockById(doc, p3)).length;
  const whole = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 0), at(doc, 4, end)), "", { split: true });
  assert.deepEqual(Span.followShots(whole.doc, shots, whole).map((s) => s.blockIds), [[p4], [p4], [p4]]);
});

test("Enter over a span: shots on the last block go with its words to the new block", () => {
  const doc = Doc.parse(SCRIPT);
  const [, , p1, p2, p3] = ids(doc);
  const shots = [{ id: "B1", blockIds: [p2] }, { id: "B2", blockIds: [p3] }];
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, 6)), "", { split: true });
  assert.deepEqual(Span.followShots(r.doc, shots, r), [
    { id: "B1", blockIds: [p1], moved: true },
    { id: "B2", blockIds: [r.caret.id], moved: true },
  ]);
});

// The cases below are the last block's words left or not after Enter (or a paste with blank lines), one per test.
const twoParas = () => {
  const doc = Doc.parse(SCRIPT);
  const [, , p1, p2, p3] = ids(doc);
  return { doc, p1, p3, shots: [{ id: "B1", blockIds: [p2] }, { id: "B2", blockIds: [p3] }] };
};

test("Enter over a span: pasted text with a blank line makes a new block too; the last block's words end up there", () => {
  const { doc, shots } = twoParas();
  const pasted = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, 6)), "one\n\ntwo ");
  assert.deepEqual(Span.followShots(pasted.doc, shots, pasted)[1], { id: "B2", blockIds: [pasted.caret.id], moved: true });
});

test("Enter over a span to the very end of its last block leaves no words of it: the new block is empty, the shot stays at the join", () => {
  const { doc, p1, p3, shots } = twoParas();
  const end = Doc.contentOf(Doc.blockById(doc, p3)).length;
  const whole = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, end)), "", { split: true });
  assert.deepEqual(Span.followShots(whole.doc, shots, whole)[1], { id: "B2", blockIds: [p1], moved: true });
  const wholePaste = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 4, end)), "one\n\ntwo");
  assert.deepEqual(Span.followShots(wholePaste.doc, shots, wholePaste)[1], { id: "B2", blockIds: [p1], moved: true }, "pasted words are not the last block's");
});

test("Enter over a span: a last block that ends in bold, selected up to its closing marks, leaves only the marks, no words", () => {
  const bold = Doc.parse("# Title\n\n## 1 · Hook\n\nFirst para one.\n\nSecond para **two**\n");
  const [, , b1, b2] = ids(bold), len = Doc.contentOf(Doc.blockById(bold, b2)).length;
  const marks = Span.replaceSpan(bold, Span.spanOf(bold, at(bold, 2, 6), at(bold, 3, len - 2)), "", { split: true });
  assert.equal(marks.rest, false, "no words of the last block are left");
  assert.deepEqual(Span.followShots(marks.doc, [{ id: "B2", blockIds: [b2] }], marks), [{ id: "B2", blockIds: [b1], moved: true }]);
});

// A last block that ends in a link; `words`: where its words end and its address starts.
const LINKED = "# Title\n\n## 1 · Hook\n\nFirst para one.\n\nSecond [two](https://example.com)\n";
const linkedDoc = () => {
  const link = Doc.parse(LINKED);
  const [, , l1, l2] = ids(link);
  return { link, l1, l2, words: Doc.contentOf(Doc.blockById(link, l2)).indexOf("](") };
};

test("Enter over a span: a last block that ends in a link, selected up to the end of its words, leaves no words (the hidden address is none)", () => {
  const { link, l1, l2, words } = linkedDoc();
  const linked = Span.replaceSpan(link, Span.spanOf(link, at(link, 2, 6), at(link, 3, words)), "", { split: true });
  assert.equal(linked.rest, false, "no words of the last block are left");
  assert.deepEqual(Span.followShots(linked.doc, [{ id: "B2", blockIds: [l2] }], linked), [{ id: "B2", blockIds: [l1], moved: true }]);
});

test("Enter over a span: words after a link are still words left", () => {
  const after = Doc.parse("# Title\n\n## 1 · Hook\n\nFirst para one.\n\nSecond [two](https://example.com) three\n");
  const at2 = Doc.contentOf(after.blocks[3]).indexOf("](");
  assert.equal(Span.replaceSpan(after, Span.spanOf(after, at(after, 2, 6), at(after, 3, at2)), "", { split: true }).rest, true);
});

test("Enter over a span: letters outside the basic range (Adlam, two code units each) are words too; the shot goes with them", () => {
  const adlam = Doc.parse("# Title\n\n## 1 · Hook\n\nFirst para one.\n\nSecond 𞤀𞤣𞤤𞤢𞤥\n");
  const [, , d1, d2] = ids(adlam);
  const kept = Span.replaceSpan(adlam, Span.spanOf(adlam, at(adlam, 2, 6), at(adlam, 3, 7)), "", { split: true });
  assert.equal(kept.rest, true, "the Adlam word is left");
  assert.deepEqual(Span.followShots(kept.doc, [{ id: "B2", blockIds: [d2] }], kept), [{ id: "B2", blockIds: [kept.caret.id], moved: true }]);
  assert.notEqual(kept.caret.id, d1);
});

test("Enter over a span: a reference line cut at its \"- \" leaves spoken words, so the shot goes with them", () => {
  const ref = Doc.parse("# Title\n\n## 1 · Hook\n\nFirst para one.\n\nSecond paragraph.\n- Reference: https://example.com\n");
  const [, , r1, r2] = ids(ref), dash = Doc.contentOf(Doc.blockById(ref, r2)).indexOf("- ") + 2;
  const cutRef = Span.replaceSpan(ref, Span.spanOf(ref, at(ref, 2, 6), at(ref, 3, dash)), "", { split: true });
  assert.equal(cutRef.rest, true, "the reference's words are left");
  assert.notEqual(cutRef.caret.id, r1);
  assert.deepEqual(Span.followShots(cutRef.doc, [{ id: "B2", blockIds: [r2] }], cutRef), [{ id: "B2", blockIds: [cutRef.caret.id], moved: true }]);
});

test("Enter over a span: words that would sit inside a reference's address when joined are a paragraph of their own, with the shot", () => {
  // The words left are read where they end up. Joined, "today." would sit inside the reference's address; after Enter
  // (or a paste with a blank line) it is a paragraph of its own, so the shot goes with it.
  const addr = Doc.parse("# Title\n\n## 1 · Hook\n\nFirst para.\n- Reference: https://example.com\n\nSecond ends today.\n");
  const [, , a1, a2] = ids(addr);
  const from = Doc.contentOf(Doc.blockById(addr, a1)).indexOf("example.com"), to = Doc.contentOf(Doc.blockById(addr, a2)).indexOf("today.");
  for (const [text, opts] of [["", { split: true }], ["pasted\n\nmore ", {}]]) {
    const r = Span.replaceSpan(addr, Span.spanOf(addr, at(addr, 2, from), at(addr, 3, to)), text, opts);
    assert.equal(r.rest, true, `"today." is left (${JSON.stringify(text)})`);
    assert.notEqual(r.caret.id, a1);
    assert.deepEqual(Span.followShots(r.doc, [{ id: "B2", blockIds: [a2] }], r), [{ id: "B2", blockIds: [r.caret.id], moved: true }]);
  }
});

test("Enter over a span: a bare address that would follow \"- Source: \" when joined is spoken words after Enter", () => {
  const src = Doc.parse("# Title\n\n## 1 · Hook\n\nIntro.\n- Source: x\n\nSee https://example.com\n");
  const [, , s1, s2] = ids(src);
  const srcEnd = Doc.contentOf(Doc.blockById(src, s1)).length - 1;
  const bare = Span.replaceSpan(src, Span.spanOf(src, at(src, 2, srcEnd), at(src, 3, 4)), "", { split: true });
  assert.equal(bare.rest, true, "the address is left as spoken words");
  assert.deepEqual(Span.followShots(bare.doc, [{ id: "B2", blockIds: [s2] }], bare), [{ id: "B2", blockIds: [bare.caret.id], moved: true }]);
});

test("Enter over a span: joined into a section title, nothing settles the link; its literal address is words left", () => {
  const { link, words } = linkedDoc();
  const title = Span.replaceSpan(link, Span.spanOf(link, at(link, 1, 3), at(link, 3, words)), "", { split: true });
  assert.equal(title.doc.blocks[1].type, "heading");
  assert.equal(title.rest, true, "the address is literal text in a section title");
});

test("Enter over a span: a list item that ends in a link, joined into a paragraph, leaves no words; its shot stays at the join", () => {
  // The paragraph settles the link, so its address is no words left.
  const list = Doc.parse("# Title\n\n## 1 · Hook\n\nFirst para one.\n\n- see [two](https://example.com)\n");
  const [, , i1, i2] = ids(list), cut = Doc.contentOf(Doc.blockById(list, i2)).indexOf("](");
  assert.equal(Doc.blockById(list, i2).type, "raw", "a list is kept as plain text");
  const item = Span.replaceSpan(list, Span.spanOf(list, at(list, 2, 6), at(list, 3, cut)), "", { split: true });
  assert.equal(Doc.blockById(item.doc, i1).type, "para");
  assert.equal(Doc.contentOf(Doc.blockById(item.doc, i1)), "First ");
  assert.equal(item.rest, false, "no words of the list item are left");
  assert.deepEqual(Span.followShots(item.doc, [{ id: "B3", blockIds: [i2] }], item), [{ id: "B3", blockIds: [i1], moved: true }]);
});

// TOOLS-484: asks and "Sounds like me" marks on words the span leaves go with those words by their offsets
// (replaceSpan's `follow`), never by a search for their quote: a repeated word has more than one copy.
const followed = (r, side, start, end) => {
  const to = r.follow(side, start, end);
  return to && { ...to, reads: Doc.contentOf(Doc.blockById(r.doc, to.id)).slice(to.start, to.end) };
};

test("follow: an ask on a repeated word before the span stays on that copy when the delete takes the bold marks", () => {
  const doc = Doc.parse("# T\n\n**go go go live**\n\nOther paragraph.\n");
  const [, a] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 11), at(doc, 2, 6)), "");
  assert.equal(Doc.contentOf(Doc.blockById(r.doc, a)), "go go go paragraph.");
  assert.deepEqual(followed(r, "first", 2, 4), { id: a, start: 0, end: 2, quote: "go", reads: "go" }, "the first \"go\"");
  assert.deepEqual(followed(r, "first", 5, 7), { id: a, start: 3, end: 5, quote: "go", reads: "go" }, "the second \"go\"");
  assert.deepEqual(followed(r, "first", 8, 10), { id: a, start: 6, end: 8, quote: "go", reads: "go" }, "the third \"go\"");
  assert.deepEqual(followed(r, "last", 6, 15), { id: a, start: 9, end: 18, quote: "paragraph", reads: "paragraph" });
  // Words the span took, or cut, have no place.
  assert.equal(r.follow("first", 8, 15), null, "cut by the span's start");
  assert.equal(r.follow("first", 11, 15), null, "inside the span");
  assert.equal(r.follow("last", 0, 5), null, "inside the span, in the last block");
  assert.equal(r.follow("last", 4, 9), null, "cut by the span's end");
});

test("follow: an ask on a repeated word after the span stays on that copy when the delete takes the bold marks before it", () => {
  const doc = Doc.parse("# T\n\nIntro words\n\n**live go** go go end\n");
  const [, a] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 6), at(doc, 2, 7)), "");
  assert.equal(Doc.contentOf(Doc.blockById(r.doc, a)), "Intro go go go end");
  assert.deepEqual(followed(r, "last", 7, 9), { id: a, start: 6, end: 8, quote: "go", reads: "go" }, "the first \"go\"");
  assert.deepEqual(followed(r, "last", 12, 14), { id: a, start: 9, end: 11, quote: "go", reads: "go" }, "the second \"go\"");
  assert.deepEqual(followed(r, "last", 15, 17), { id: a, start: 12, end: 14, quote: "go", reads: "go" }, "the third \"go\"");
  assert.deepEqual(followed(r, "first", 0, 5), { id: a, start: 0, end: 5, quote: "Intro", reads: "Intro" });
});

test("follow: bold words that stay bold keep their marks in the quote; typed text goes between the two sides", () => {
  const doc = Doc.parse("# T\n\nSay **go go** now and then\n\nOther go **go go** end\n");
  const [, a] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 17), at(doc, 2, 6)), " XY ");
  assert.equal(Doc.contentOf(Doc.blockById(r.doc, a)), "Say **go go** now XY go **go go** end");
  assert.deepEqual(followed(r, "first", 9, 11), { id: a, start: 9, end: 11, quote: "go", reads: "go" }, "the second \"go\" before the span");
  assert.deepEqual(followed(r, "first", 4, 13), { id: a, start: 4, end: 13, quote: "**go go**", reads: "**go go**" }, "bold words before the span, marks and all");
  assert.deepEqual(followed(r, "first", 14, 17), { id: a, start: 14, end: 17, quote: "now", reads: "now" }, "words that end where the span starts stay before what is typed");
  assert.deepEqual(followed(r, "last", 6, 8), { id: a, start: 21, end: 23, quote: "go", reads: "go" }, "words that start where the span ends go after what is typed");
  assert.deepEqual(followed(r, "last", 9, 18), { id: a, start: 24, end: 33, quote: "**go go**", reads: "**go go**" }, "bold words after the span, marks and all");
  assert.deepEqual(followed(r, "last", 14, 16), { id: a, start: 29, end: 31, quote: "go", reads: "go" }, "the last \"go\" after the span");
});

test("follow: Enter over the span takes the last block's words to the new block; the first block's stay", () => {
  const doc = Doc.parse("# T\n\n**go go go live**\n\nOther **go go** end\n");
  const [, a] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 11), at(doc, 2, 6)), "", { split: true });
  assert.deepEqual(contents(r.doc).slice(1), ["para:go go go ", "para:**go go** end"]);
  assert.notEqual(r.caret.id, a);
  assert.deepEqual(followed(r, "first", 5, 7), { id: a, start: 3, end: 5, quote: "go", reads: "go" });
  assert.deepEqual(followed(r, "last", 11, 13), { id: r.caret.id, start: 5, end: 7, quote: "go", reads: "go" });
  assert.deepEqual(followed(r, "last", 16, 19), { id: r.caret.id, start: 10, end: 13, quote: "end", reads: "end" });
});

test("follow: pasted text with a blank line makes paragraphs; each side's words are found in the block they went to", () => {
  const doc = Doc.parse(SCRIPT);
  const [, , a] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 2, 6), at(doc, 3, 7)), "X\n\nY");
  assert.deepEqual(contents(r.doc).slice(2, 4), ["para:First X", "para:Ypara two."]);
  assert.deepEqual(followed(r, "first", 0, 5), { id: a, start: 0, end: 5, quote: "First", reads: "First" });
  assert.deepEqual(followed(r, "last", 7, 11), { id: r.doc.blocks[3].id, start: 1, end: 5, quote: "para", reads: "para" });
  assert.deepEqual(followed(r, "last", 12, 15), { id: r.doc.blocks[3].id, start: 6, end: 9, quote: "two", reads: "two" });
});

test("follow: a paragraph joined into a section title keeps its words on one line; words across a line break have no place", () => {
  const doc = Doc.parse("# T\n\n## 1 · Hook\n\nOne go go\ntwo go go three.\n");
  const [, h] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 4), at(doc, 2, 4)), "");
  assert.deepEqual(contents(r.doc).slice(1), ["heading:1 · go go two go go three."]);
  assert.deepEqual(followed(r, "first", 0, 1), { id: h, start: 0, end: 1, quote: "1", reads: "1" });
  assert.deepEqual(followed(r, "last", 7, 9), { id: h, start: 7, end: 9, quote: "go", reads: "go" }, "the second \"go\" of the first line");
  assert.deepEqual(followed(r, "last", 14, 16), { id: h, start: 14, end: 16, quote: "go", reads: "go" }, "the first \"go\" of the second line");
  assert.deepEqual(followed(r, "last", 17, 19), { id: h, start: 17, end: 19, quote: "go", reads: "go" }, "the second \"go\" of the second line");
  assert.equal(r.follow("last", 7, 13), null, "\"go\\ntwo\" reads \"go two\" now");
});

// Every span from each first block to each last one, five edits, every word outside the span: where `follow` puts it.
// The blocks are given as Markdown; the offsets are in their content (a section title's "## " is not part of it).
const sweepFollow = (firsts, lasts) => {
  const plain = (s) => s.replaceAll("**", "");
  const edits = [["", {}], ["X", {}], [" ", {}], ["", { split: true }], ["A\n\nB", {}]];
  const inMark = (s, i) => (s[i - 1] === "*" && s[i] === "*") && (s.slice(0, i).match(/\*+$/)[0].length % 2 === 1);
  let placed = 0, gone = 0;
  for (const first of firsts) for (const last of lasts) {
    const doc = Doc.parse(`# T\n\n${first}\n\n${last}\n`);
    const [, a] = ids(doc);
    const head = Doc.contentOf(doc.blocks[1]), tail = Doc.contentOf(doc.blocks[2]);
    for (let from = 0; from <= head.length; from++) for (let to = 0; to <= tail.length; to++) {
      if (inMark(head, from) || inMark(tail, to)) continue;
      for (const [put, how] of edits) {
        const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, from), at(doc, 2, to)), put, how);
        if (!r) continue; // refused: nothing changes
        const where = `"${head}" from ${from} to ${to} of "${tail}", ${JSON.stringify(put)}${how.split ? " Enter" : ""}`;
        for (const [side, text] of [["first", head], ["last", tail]]) {
          for (const m of text.matchAll(/[A-Za-z]+/g)) {
            const start = m.index, end = start + m[0].length;
            if (side === "first" ? end > from : start < to) { assert.equal(r.follow(side, start, end), null, `${where}: "${m[0]}" at ${start} of the ${side} is not outside the span`); continue; }
            const now = r.follow(side, start, end);
            if (!now) { gone++; continue; }
            placed++;
            const content = Doc.contentOf(Doc.blockById(r.doc, now.id));
            assert.equal(now.quote, m[0], `${where}: the quote of "${m[0]}" at ${start} of the ${side}`);
            assert.equal(content.slice(now.start, now.end), m[0], `${where}: "${m[0]}" at ${start} of the ${side} reads there`);
            // The same copy: what was before it in its paragraph still is (first block), or what was after it (last).
            if (side === "first") {
              assert.equal(now.id, a, `${where}: "${m[0]}" at ${start} stays in the first block`);
              assert.equal(plain(content.slice(0, now.start)), plain(head.slice(0, start)), `${where}: the words before "${m[0]}" at ${start} of the first`);
            } else assert.equal(plain(content.slice(now.end)), plain(tail.slice(end)), `${where}: the words after "${m[0]}" at ${start} of the last`);
          }
        }
      }
    }
  }
  return { placed, gone };
};

test("follow: every word outside the span keeps the words around it, wherever the span is and whatever replaces it", (t) => {
  const { placed, gone } = sweepFollow(
    ["**go go go live**", "go **go** go live now", "Say go, go and go", "**go** go **go** end"],
    ["Other paragraph.", "**live go** go go end", "Other **go go** go", "go go **go** go", "Other go go end."],
  );
  t.diagnostic(`${placed} words placed, ${gone} gone`);
  assert.ok(placed > 100000, `the sweep ran: ${placed} words placed`);
  assert.equal(gone, 0, "no word outside the span is lost");
});

test("follow: the same in a list item, a section title and a reminder, and when Enter's new paragraph starts as a section title or a list item", (t) => {
  const { placed, gone } = sweepFollow(
    ["- go **go** go", "## go go end", "[ON SCREEN: go go]", "Say go, go and go"],
    ["## go go end", "- go **go** go", "x ## go go end", "x - go **go** go", "[ON SCREEN: go go]"],
  );
  t.diagnostic(`${placed} words placed, ${gone} gone`);
  assert.ok(placed > 20000, `the sweep ran: ${placed} words placed`);
  assert.equal(gone, 0, "no word outside the span is lost");
});

test("follow: a span from a paragraph's start into a section title leaves the title without blanks at its start; its words and the caret are where they read", () => {
  const doc = Doc.parse("# T\n\nIntro go\n\n## go go end\n");
  const [, a] = ids(doc);
  // What is left of the title starts with a blank, and so does a typed space: the "## " takes both.
  for (const [put, how, blocks, caret] of [
    ["", {}, ["heading:go end"], 0],
    [" ", {}, ["heading:go end"], 0],
    ["X", {}, ["heading:X go end"], 1],
    ["", { split: true }, ["para:", "heading:go end"], 0],
  ]) {
    const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 0), at(doc, 2, 2)), put, how);
    const what = `${JSON.stringify(put)}${how.split ? " Enter" : ""}`;
    assert.deepEqual(contents(r.doc).slice(1), blocks, what);
    assert.deepEqual(r.caret, { id: a, offset: caret }, `${what}: the caret`);
    assert.deepEqual(followed(r, "last", 3, 5), { id: a, start: caret + (put === "X" ? 1 : 0), end: caret + (put === "X" ? 3 : 2), quote: "go", reads: "go" }, `${what}: the second "go"`);
    assert.equal(r.follow("last", 6, 9).quote, "end", what);
  }
});

test("follow: a line left as \"# …\" in a script that has its title is plain text; the words after its \"# \" are where they read", () => {
  const doc = Doc.parse("# T\n\nIntro go\n\nx # go go end\n");
  const [, a] = ids(doc);
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 0), at(doc, 2, 2)), "");
  assert.deepEqual(contents(r.doc).slice(1), ["raw:# go go end"]);
  assert.deepEqual(followed(r, "last", 4, 6), { id: a, start: 2, end: 4, quote: "go", reads: "go" }, "the first \"go\"");
  assert.deepEqual(followed(r, "last", 7, 9), { id: a, start: 5, end: 7, quote: "go", reads: "go" }, "the second \"go\"");
});

test("follow: Enter before \"## \" makes the rest a section title, and an ask after it goes to its own copy there", () => {
  const doc = Doc.parse("# T\n\nIntro words\n\nx ## go go end\n");
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, 6), at(doc, 2, 2)), "", { split: true });
  assert.deepEqual(contents(r.doc).slice(1), ["para:Intro ", "heading:go go end"]);
  const h = ids(r.doc)[2];
  assert.deepEqual(followed(r, "last", 5, 7), { id: h, start: 0, end: 2, quote: "go", reads: "go" }, "the first \"go\"");
  assert.deepEqual(followed(r, "last", 8, 10), { id: h, start: 3, end: 5, quote: "go", reads: "go" }, "the second \"go\"");
  assert.deepEqual(followed(r, "last", 11, 14), { id: h, start: 6, end: 9, quote: "end", reads: "end" });
});

test("follow: a link cut by the span keeps the words that are left; an ask before it stays on its own copy", () => {
  const doc = Doc.parse("# T\n\nRead it, read [it and more](https://example.com) now\n\nOther it end\n");
  const [, a] = ids(doc);
  const cut = "Read it, read [it".length;
  const r = Span.replaceSpan(doc, Span.spanOf(doc, at(doc, 1, cut), at(doc, 2, 6)), "");
  const joined = Doc.contentOf(Doc.blockById(r.doc, a));
  assert.equal(joined, "Read it, read [it](https://example.com)it end");
  assert.deepEqual(followed(r, "first", 5, 7), { id: a, start: 5, end: 7, quote: "it", reads: "it" }, "the first \"it\"");
  assert.deepEqual(followed(r, "first", 15, 17), { id: a, start: 15, end: 17, quote: "it", reads: "it" }, "the link's \"it\"");
  assert.deepEqual(followed(r, "last", 6, 8), { id: a, start: joined.lastIndexOf("it end"), end: joined.lastIndexOf("it end") + 2, quote: "it", reads: "it" }, "the last block's \"it\"");
});
