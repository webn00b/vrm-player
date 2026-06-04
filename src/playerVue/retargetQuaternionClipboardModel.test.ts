import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildQuaternionClipboardJson,
  parseQuaternionClipboardJson,
} from './retargetLab/retargetQuaternionClipboardModel';

test('buildQuaternionClipboardJson rounds quaternion and euler fields for clipboard export', () => {
  const json = buildQuaternionClipboardJson({
    bone: 'hips',
    quat: { x: 0.123456789, y: 0, z: 0.5, w: 0.866025404 },
    eulerDeg: { x: 1.23456, y: 2.34567, z: 3.45678 },
  });

  assert.equal(json, [
    '{',
    '  "bone": "hips",',
    '  "q": [',
    '    0.12345679,',
    '    0,',
    '    0.5,',
    '    0.8660254',
    '  ],',
    '  "eulerDeg": {',
    '    "x": 1.235,',
    '    "y": 2.346,',
    '    "z": 3.457,',
    '    "order": "YXZ"',
    '  }',
    '}',
  ].join('\n'));
});

test('parseQuaternionClipboardJson accepts q tuple and optional bone', () => {
  assert.deepEqual(parseQuaternionClipboardJson('{"bone":"head","q":[0,0,0,1]}'), {
    bone: 'head',
    q: [0, 0, 0, 1],
  });
});

test('parseQuaternionClipboardJson rejects missing or invalid q tuples', () => {
  assert.throws(
    () => parseQuaternionClipboardJson('{"q":[0,0,1]}'),
    /Clipboard JSON has no q: \[x,y,z,w\]/,
  );
  assert.throws(
    () => parseQuaternionClipboardJson('{"q":[0,0,"bad",1]}'),
    /Clipboard JSON has no q: \[x,y,z,w\]/,
  );
});
