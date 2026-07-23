// dbservice.js — moving captured scans out of data.json and into MongoDB.
//
// It reads ./data.json relative to wherever it was started and then asks whether to
// clear the file, so each test runs in a temporary working directory with its own
// data.json and answers the prompt over stdin.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    baseEnv, db, resetDb, runInteractive, runToCompletion, startMongo, stopMongo, tempDir
} = require('./helpers/harness');

const PROMPTS = ['Do you want to delete the information in the JSON file?'];

let mongoUrl;

test.before(async () => {
    mongoUrl = await startMongo();
});

test.after(async () => {
    await stopMongo();
});

test.beforeEach(async () => {
    await resetDb();
});

const SCANS = [
    { input: '111', timestamp: '2024-09-18T10:12:09.741Z' },
    { input: '333', timestamp: '2024-09-18T10:12:06.019Z' }
];

function givenCapturedScans(scans = SCANS) {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'data.json'), JSON.stringify(scans, null, 2));
    return cwd;
}

const readData = cwd => JSON.parse(fs.readFileSync(path.join(cwd, 'data.json'), 'utf8'));

// Answer the clear-the-file question.
const run = (cwd, answer) => runInteractive('dbservice', {
    cwd,
    lines: [answer],
    prompts: PROMPTS,
    env: baseEnv(mongoUrl)
});

test('captured scans are written to the database', async () => {
    const cwd = givenCapturedScans();

    const result = await run(cwd, 'no');
    assert.equal(result.code, 0, `dbservice failed:\n${result.output}`);

    const stored = await db().collection('groceryitems').find().toArray();
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map(scan => scan.input).sort(), ['111', '333']);
});

test('the timestamp is carried across unchanged', async () => {
    const cwd = givenCapturedScans();

    await run(cwd, 'no');

    const stored = await db().collection('groceryitems').findOne({ input: '111' });
    assert.equal(stored.timestamp, '2024-09-18T10:12:09.741Z');
});

test('it reports which codes were saved', async () => {
    const cwd = givenCapturedScans();

    const result = await run(cwd, 'no');

    assert.match(result.stdout, /Successfully saved numbers:/);
    assert.match(result.stdout, /111/);
});

test('answering no leaves the capture file alone', async () => {
    const cwd = givenCapturedScans();

    const result = await run(cwd, 'no');

    assert.equal(readData(cwd).length, 2, 'the scans should still be on disk');
    assert.match(result.stdout, /JSON file was not cleared/);
});

test('answering yes empties the capture file', async () => {
    const cwd = givenCapturedScans();

    const result = await run(cwd, 'yes');

    assert.deepEqual(readData(cwd), [], 'the file should be emptied, not deleted');
    assert.match(result.stdout, /JSON file cleared/);
});

test('an empty capture file is handled without complaint', async () => {
    const cwd = givenCapturedScans([]);

    const result = await runToCompletion('dbservice', { cwd, env: baseEnv(mongoUrl) });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /No data to process/);
    assert.equal(await db().collection('groceryitems').countDocuments(), 0);
});

// Regression. A missing capture file is the state of a clean checkout, before the
// Arduino or the simulator has produced anything.
test('a missing capture file is explained rather than crashed on', async () => {
    const cwd = tempDir();

    const result = await runToCompletion('dbservice', { cwd, env: baseEnv(mongoUrl) });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /JSON file not found/);
});

// Regression. Without MONGO_URL the service used to fail with a driver stack trace
// rather than telling the user what was missing.
test('no database URL is refused with an explanation, not a stack trace', async () => {
    const cwd = givenCapturedScans();
    const env = { ...process.env };
    delete env.MONGO_URL;

    const result = await runToCompletion('dbservice', { cwd, env });

    assert.notEqual(result.code, 0, 'it must fail closed');
    assert.match(result.stderr, /MONGO_URL is not set/);
    assert.match(result.stderr, /See the README/);
    assert.doesNotMatch(result.output, /at .*node_modules/, 'no driver stack trace');
});

// Regression, and the reason this file exists at all.
//
// The connection string carries the database password. It was once logged on
// startup, which put a live credential into anything collecting the output. These
// two tests cover both halves of the risk: the ordinary path, and the failure path
// where drivers are most tempted to echo what they were given.
test('the connection string is never printed on the happy path', async () => {
    const cwd = givenCapturedScans();

    const result = await run(cwd, 'no');

    assert.ok(
        !result.output.includes(mongoUrl),
        'the connection string must not appear in the output'
    );
});

test('the password is not leaked when the connection string is rejected', async () => {
    const cwd = givenCapturedScans();
    const password = 'HorseBatteryStaple';
    const env = {
        ...process.env,
        MONGO_URL: `not-a-valid-scheme://user:${password}@cluster.example.com/grocerydb`
    };

    const result = await runToCompletion('dbservice', { cwd, env });

    assert.notEqual(result.code, 0);
    assert.ok(
        !result.output.includes(password),
        `the password appeared in the output:\n${result.output}`
    );
});
