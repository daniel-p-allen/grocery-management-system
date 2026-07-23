// seed.js — putting a small pantry into an empty database.
//
// It is run by docker compose every time the frontend is rebuilt, so running it
// twice has to be safe. That is the behaviour most of this file is about.

const test = require('node:test');
const assert = require('node:assert');

const {
    baseEnv, db, resetDb, runToCompletion, startMongo, stopMongo
} = require('./helpers/harness');

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

const seed = () => runToCompletion('seed', { env: baseEnv(mongoUrl) });

const productOf = itemNo => db().collection('items').findOne({ itemNo });
const countItems = () => db().collection('items').countDocuments();
const countScans = () => db().collection('groceryitems').countDocuments();

test('seeding an empty database creates the pantry', async () => {
    const result = await seed();

    assert.equal(result.code, 0, `seed failed:\n${result.output}`);
    assert.equal(await countItems(), 4);

    const eggs = await productOf('111');
    assert.equal(eggs.itemName, 'Eggs');
    assert.equal(eggs.currentStockLevel, 12);
    assert.equal(eggs.desiredStockLevel, 12);
});

test('seeding an empty database creates the sample scans', async () => {
    await seed();

    assert.equal(await countScans(), 5);

    const unprocessed = await db().collection('groceryitems').countDocuments({ processed: false });
    assert.equal(unprocessed, 5, 'seeded scans should be waiting to be processed');
});

// Regression, and the most valuable test in this file.
//
// An earlier version upserted with $set, which reset every product to its starting
// quantity on the second run. The scans were already present so they were not
// reprocessed — leaving a full pantry and an empty shopping list, which looks like
// the system simply does not work.
test('seeding twice does not reset stock that has moved', async () => {
    await seed();

    // The system has since consumed some eggs.
    await db().collection('items').updateOne(
        { itemNo: '111' },
        { $set: { currentStockLevel: 3 } }
    );

    const second = await seed();
    assert.equal(second.code, 0, `second seed failed:\n${second.output}`);

    assert.equal(
        (await productOf('111')).currentStockLevel,
        3,
        'the second seed must not restore the starting quantity'
    );
});

test('seeding twice does not duplicate the pantry', async () => {
    await seed();
    await seed();

    assert.equal(await countItems(), 4);
});

test('seeding twice does not duplicate the scans', async () => {
    await seed();
    await seed();

    assert.equal(await countScans(), 5);
});

test('a second seed says it left things alone', async () => {
    await seed();
    const second = await seed();

    assert.match(second.stdout, /already present; stock left untouched/);
});

// The processing loop marks a scan as processed whether or not a matching product
// exists, so a scan inserted before its product would be consumed and lost. The
// catalogue therefore has to be written first.
test('products exist before any scan does', async () => {
    await seed();

    const products = await db().collection('items').find().toArray();
    const scans = await db().collection('groceryitems').find().toArray();

    const scannedCodes = new Set(scans.map(scan => scan.input));
    const stockedCodes = new Set(products.map(product => product.itemNo));

    for (const code of scannedCodes) {
        assert.ok(stockedCodes.has(code), `scan ${code} has no matching product`);
    }
});

test('seeding backdates the last order date so ordering has something to do', async () => {
    await seed();

    const settings = await db().collection('settings').findOne({ key: 'lastOrderDate' });
    assert.ok(settings, 'lastOrderDate should exist');

    const daysAgo = (Date.now() - new Date(settings.lastOrderDate).getTime()) / 86400000;
    assert.ok(daysAgo > 6.9 && daysAgo < 7.1, `expected about 7 days, got ${daysAgo}`);
});

// Regression. Without MONGO_URL the service used to fail with a driver stack trace.
test('seeding without a database URL fails with an explanation, not a stack trace', async () => {
    const env = { ...process.env };
    delete env.MONGO_URL;

    const result = await runToCompletion('seed', { env });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /MONGO_URL is not set/);
    assert.doesNotMatch(result.output, /at .*node_modules/, 'no driver stack trace');
});
