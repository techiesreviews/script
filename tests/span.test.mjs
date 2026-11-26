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
