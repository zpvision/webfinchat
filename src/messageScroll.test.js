import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMessagePosition, restoreMessagePosition, isNearMessageBottom } from './messageScroll.js';

function viewport() {
  const container = { scrollTop: 180, clientTop: 0, clientHeight: 300,
    rows: Array.from({ length: 30 }, (_, index) => ({ seq: 500 + index, height: 60 })),
    get scrollHeight() { return this.rows.reduce((sum, row) => sum + row.height, 0); },
    getBoundingClientRect: () => ({ top: 20 }),
    querySelectorAll() {
      let offset = 0;
      return this.rows.map((row) => {
        const y = offset;
        offset += row.height;
        return { dataset: { messageSeq: String(row.seq) }, getBoundingClientRect: () => ({ top: 20 + y - this.scrollTop, bottom: 20 + y + row.height - this.scrollTop }) };
      });
    },
  };
  return container;
}

test('eight history pages preserve visible seq and offset, including changing row heights', () => {
  const container = viewport();
  for (let page = 0; page < 8; page++) {
    const position = captureMessagePosition(container);
    const first = container.rows[0].seq;
    container.rows.unshift(...Array.from({ length: 30 }, (_, i) => ({ seq: first - 30 + i, height: 45 + i % 3 * 10 })));
    assert.equal(restoreMessagePosition(container, position), true);
    const after = captureMessagePosition(container);
    assert.equal(after.seq, position.seq);
    assert.equal(after.offset, position.offset);
  }
});

test('capture immediately before mutation respects scrolling while history request was pending', () => {
  const container = viewport();
  const requestStart = captureMessagePosition(container);
  container.scrollTop += 200;
  const current = captureMessagePosition(container);
  container.rows.unshift({ seq: 499, height: 150 });
  restoreMessagePosition(container, current);
  assert.equal(captureMessagePosition(container).seq, current.seq);
  assert.notEqual(current.seq, requestStart.seq);
});

test('incoming message and late image above viewport preserve reading anchor', () => {
  const container = viewport();
  const position = captureMessagePosition(container);
  container.rows.push({ seq: 530, height: 90 });
  restoreMessagePosition(container, position);
  assert.equal(container.scrollTop, position.scrollTop);
  container.rows[0].height += 350;
  restoreMessagePosition(container, position);
  const after = captureMessagePosition(container);
  assert.equal(after.seq, position.seq);
  assert.equal(after.offset, position.offset);
  assert.equal(isNearMessageBottom(container), false);
});

test('deleting first visible message restores the next visible anchor; bottom tolerance is explicit', () => {
  const container = viewport();
  const position = captureMessagePosition(container);
  container.rows = container.rows.filter((row) => String(row.seq) !== position.seq);
  restoreMessagePosition(container, position);
  const next = position.visible[1];
  const element = container.querySelectorAll().find((row) => row.dataset.messageSeq === next.seq);
  assert.equal(element.getBoundingClientRect().top - 20, next.offset);
  container.scrollTop = container.scrollHeight - container.clientHeight;
  assert.equal(isNearMessageBottom(container), true);
});
