// simulator.js — feeding the system product codes with no hardware attached.
//
// It sits on a readline prompt, so these tests drive it the way a person does: by
// writing to its stdin. Each one runs in a temporary working directory, because the
// simulator writes ./data.json relative to wherever it was started — running it in
// the repository would overwrite the real sample scans.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { runInteractive, tempDir } = require('./helpers/harness');

// The two questions it asks. Matched on wording unique to the prompts themselves —
// the rejection message also says "Please enter a 3-digit number", and counting that
// as a question would send the next answer a beat too early.
const PROMPTS = [
    'or type "exit" to quit',
    'How many days in the past'
];

const answers = (...lines) => lines;

function simulate(cwd, lines) {
    return runInteractive('simulator', { cwd, lines, prompts: PROMPTS, env: { ...process.env } });
}

const readData = cwd => JSON.parse(fs.readFileSync(path.join(cwd, 'data.json'), 'utf8'));

// Regression. The simulator used to hang when data.json was absent, which is the
// state of a clean checkout — so the first thing a new user tried appeared to freeze.
test('a missing data.json is created rather than hung on', async () => {
    const cwd = tempDir();

    const result = await simulate(cwd, answers('111', '0', 'exit'));

    assert.equal(result.code, 0, `simulator did not exit cleanly:\n${result.output}`);
    assert.ok(fs.existsSync(path.join(cwd, 'data.json')), 'data.json should have been created');
    assert.match(result.stdout, /not found\. Creating it/);
});

test('a scan is recorded with its code', async () => {
    const cwd = tempDir();

    await simulate(cwd, answers('333', '0', 'exit'));

    const data = readData(cwd);
    assert.equal(data.length, 1);
    assert.equal(data[0].input, '333');
});

test('a code is stored as a string, matching what the Arduino sends', async () => {
    const cwd = tempDir();

    await simulate(cwd, answers('555', '0', 'exit'));

    assert.strictEqual(typeof readData(cwd)[0].input, 'string');
});

test('the timestamp is backdated by the number of days given', async () => {
    const cwd = tempDir();

    await simulate(cwd, answers('111', '3', 'exit'));

    const recorded = new Date(readData(cwd)[0].timestamp);
    const daysAgo = (Date.now() - recorded.getTime()) / 86400000;

    assert.ok(daysAgo > 2.9 && daysAgo < 3.1, `expected about 3 days, got ${daysAgo}`);
});

test('the timestamp is a valid ISO date', async () => {
    const cwd = tempDir();

    await simulate(cwd, answers('111', '0', 'exit'));

    const { timestamp } = readData(cwd)[0];
    assert.ok(!Number.isNaN(Date.parse(timestamp)), `${timestamp} is not a date`);
});

test('scans accumulate rather than replacing each other', async () => {
    const cwd = tempDir();

    await simulate(cwd, answers('111', '0', '333', '0', '555', '0', 'exit'));

    const data = readData(cwd);
    assert.equal(data.length, 3);
    assert.deepEqual(data.map(scan => scan.input), ['111', '333', '555']);
});

test('an existing data.json is added to, not overwritten', async () => {
    const cwd = tempDir();
    fs.writeFileSync(
        path.join(cwd, 'data.json'),
        JSON.stringify([{ input: '999', timestamp: '2024-01-01T00:00:00.000Z' }])
    );

    await simulate(cwd, answers('111', '0', 'exit'));

    const data = readData(cwd);
    assert.equal(data.length, 2);
    assert.equal(data[0].input, '999', 'the existing scan should survive');
});

test('a code that is not three digits is refused', async () => {
    const cwd = tempDir();

    const result = await simulate(cwd, answers('12', 'exit'));

    assert.match(result.stdout, /Invalid input\. Please enter a 3-digit number/);
    assert.ok(!fs.existsSync(path.join(cwd, 'data.json')), 'nothing should have been written');
});

test('a code that is not numeric is refused', async () => {
    const cwd = tempDir();

    const result = await simulate(cwd, answers('abc', 'exit'));

    assert.match(result.stdout, /Invalid input\. Please enter a 3-digit number/);
});

test('a rejected code does not end the session', async () => {
    const cwd = tempDir();

    await simulate(cwd, answers('12', '111', '0', 'exit'));

    // It re-prompted after the bad code, and the good one that followed was kept.
    assert.deepEqual(readData(cwd).map(scan => scan.input), ['111']);
});

test('a day offset that is not a number is refused', async () => {
    const cwd = tempDir();

    const result = await simulate(cwd, answers('111', 'soon', 'exit'));

    assert.match(result.stdout, /Invalid input\. Please enter a valid number of days/);
});

test('exit leaves cleanly', async () => {
    const cwd = tempDir();

    const result = await simulate(cwd, answers('exit'));

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Exiting/);
});
