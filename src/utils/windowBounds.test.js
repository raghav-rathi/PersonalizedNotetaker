const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampBoundsToWorkArea, resizeBounds } = require('./windowBounds');

test('clamps a restored window to the usable display after scaling or monitor removal', () => {
    assert.deepEqual(clampBoundsToWorkArea({ x: 2500, y: -400, width: 1400, height: 1000 }, { x: 0, y: 0, width: 1200, height: 800 }), {
        x: 0,
        y: 0,
        width: 1200,
        height: 800,
    });
});

test('preserves valid negative display coordinates', () => {
    assert.deepEqual(clampBoundsToWorkArea({ x: -1800, y: 50, width: 900, height: 700 }, { x: -1920, y: 0, width: 1920, height: 1040 }), {
        x: -1800,
        y: 50,
        width: 900,
        height: 700,
    });
});

test('dragging the right and bottom edges grows the window from its top-left corner', () => {
    const start = { x: 100, y: 30, width: 850, height: 400 };
    assert.deepEqual(resizeBounds(start, 'right', 50, 999), { x: 100, y: 30, width: 900, height: 400 });
    assert.deepEqual(resizeBounds(start, 'bottom-right', -50, 80), { x: 100, y: 30, width: 800, height: 480 });
});

test('dragging the left edge keeps the right side in place, and the window never gets smaller than the minimum', () => {
    const start = { x: 100, y: 30, width: 850, height: 400 };
    assert.deepEqual(resizeBounds(start, 'left', 50, 0), { x: 150, y: 30, width: 800, height: 400 });
    assert.deepEqual(resizeBounds(start, 'bottom-left', 800, -500), { x: 630, y: 30, width: 320, height: 240 });
});
