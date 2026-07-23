// The scan pipeline: turning Arduino scans into stock levels.
//
// processNewGroceryItems runs on a timer rather than on demand, so these tests set
// PROCESS_INTERVAL_MS low and wait for the work to happen, the same way it happens
// in production. Nothing is called directly — the server is a real process here.

const test = require('node:test');
const assert = require('node:assert');

const {
    baseEnv, db, resetDb, startMongo, startService, stopMongo, waitFor
} = require('./helpers/harness');

const INTERVAL_MS = 300;

let server;

test.before(async () => {
    const mongoUrl = await startMongo();
    server = await startService('frontserver', {
        env: baseEnv(mongoUrl, { PROCESS_INTERVAL_MS: String(INTERVAL_MS) })
    });
});

test.after(async () => {
    if (server) await server.stop();
    await stopMongo();
});

test.beforeEach(async () => {
    await resetDb();
});

// Give the timer several chances to run, for the cases that assert nothing changed.
const severalIntervals = () => new Promise(resolve => setTimeout(resolve, INTERVAL_MS * 5));

async function givenProduct(itemNo, currentStockLevel, desiredStockLevel = 12) {
    await db().collection('items').insertOne({
        itemNo,
        itemName: `Product ${itemNo}`,
        size: '1 unit',
        desiredStockLevel,
        currentStockLevel,
        lastUpdated: new Date().toISOString()
    });
}

async function givenScan(fields) {
    await db().collection('groceryitems').insertOne({
        timestamp: new Date().toISOString(),
        processed: false,
        ...fields
    });
}

const stockOf = async itemNo =>
    (await db().collection('items').findOne({ itemNo })).currentStockLevel;

const unprocessedCount = () =>
    db().collection('groceryitems').countDocuments({ processed: false });

test('a scan of a known product reduces its stock by one', async () => {
    await givenProduct('111', 12);
    await givenScan({ input: '111' });

    await waitFor(async () => (await stockOf('111')) === 11, {
        description: 'stock to fall from 12 to 11'
    });

    assert.equal(await unprocessedCount(), 0, 'the scan should have been marked processed');
});

test('each scan is counted once, so three scans reduce stock by three', async () => {
    await givenProduct('111', 12);
    await givenScan({ input: '111' });
    await givenScan({ input: '111' });
    await givenScan({ input: '111' });

    await waitFor(async () => (await stockOf('111')) === 9, {
        description: 'stock to fall from 12 to 9'
    });
});

// Regression. Stock is clamped rather than allowed to go negative — a household
// cannot hold minus one carton of milk, and a negative level would then read as a
// shortfall forever on the shopping list.
test('stock stops at zero rather than going negative', async () => {
    await givenProduct('111', 0);
    await givenScan({ input: '111' });

    await waitFor(async () => (await unprocessedCount()) === 0, {
        description: 'the scan to be processed'
    });

    assert.equal(await stockOf('111'), 0);
});

// Regression. A scan for a product that is not in the catalogue is still marked
// processed. Without that, the same record is picked up again on every tick, for
// the life of the process — an unbounded retry loop over a record that can never
// succeed.
test('a scan for an unknown product is marked processed instead of retried forever', async () => {
    await givenScan({ input: '999' });

    await waitFor(async () => (await unprocessedCount()) === 0, {
        description: 'the unmatched scan to be marked processed'
    });
});

// Regression. Same reasoning, for a malformed record with no input at all.
test('a scan with no input is marked processed instead of retried forever', async () => {
    await db().collection('groceryitems').insertOne({
        timestamp: new Date().toISOString(),
        processed: false
    });

    await waitFor(async () => (await unprocessedCount()) === 0, {
        description: 'the malformed scan to be marked processed'
    });
});

test('a scan that has already been processed is not counted again', async () => {
    await givenProduct('111', 5);
    await db().collection('groceryitems').insertOne({
        input: '111',
        timestamp: new Date().toISOString(),
        processed: true
    });

    await severalIntervals();

    assert.equal(await stockOf('111'), 5, 'stock should be untouched');
});

// A scan written without the field at all — which is what the Arduino pipeline
// produces — is treated as unprocessed rather than skipped.
test('a scan with no processed field is picked up', async () => {
    await givenProduct('111', 4);
    await db().collection('groceryitems').insertOne({
        input: '111',
        timestamp: new Date().toISOString()
    });

    await waitFor(async () => (await stockOf('111')) === 3, {
        description: 'a scan with no processed field to be counted'
    });
});

test('scans for different products are applied to the right ones', async () => {
    await givenProduct('111', 10);
    await givenProduct('333', 10);
    await givenScan({ input: '111' });
    await givenScan({ input: '333' });
    await givenScan({ input: '333' });

    await waitFor(async () => (await stockOf('111')) === 9 && (await stockOf('333')) === 8, {
        description: 'each product to fall by its own scan count'
    });
});
