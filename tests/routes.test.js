// The web routes, driven over HTTP against a real running server.
//
// The scan timer is turned off here by setting PROCESS_INTERVAL_MS very high, so
// background processing cannot change stock levels underneath a route assertion.
// The pipeline itself is covered in pipeline.test.js.

const test = require('node:test');
const assert = require('node:assert');

const {
    baseEnv, db, get, postForm, resetDb, startMongo, startService, stopMongo
} = require('./helpers/harness');

let server;

test.before(async () => {
    const mongoUrl = await startMongo();
    server = await startService('frontserver', {
        env: baseEnv(mongoUrl, { PROCESS_INTERVAL_MS: '3600000' })
    });
});

test.after(async () => {
    if (server) await server.stop();
    await stopMongo();
});

test.beforeEach(async () => {
    await resetDb();
});

async function givenProduct(itemNo, itemName, currentStockLevel, desiredStockLevel) {
    await db().collection('items').insertOne({
        itemNo,
        itemName,
        size: '1 unit',
        desiredStockLevel,
        currentStockLevel,
        lastUpdated: new Date().toISOString()
    });
}

const productOf = itemNo => db().collection('items').findOne({ itemNo });

test('the right customer number is let in', async () => {
    const response = await postForm('/authenticate', { customerNumber: '1234' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/main');
});

test('the wrong customer number is refused', async () => {
    const response = await postForm('/authenticate', { customerNumber: '9999' });

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Authentication Error/);
    assert.doesNotMatch(body, /Current Shopping List/, 'must not fall through to the app');
});

test('an empty customer number is refused', async () => {
    const response = await postForm('/authenticate', { customerNumber: '' });

    const body = await response.text();
    assert.match(body, /Authentication Error/);
});

test('the shopping list holds exactly the items that are short', async () => {
    await givenProduct('111', 'Eggs', 4, 12);    // short by 8
    await givenProduct('333', 'Bread', 4, 4);    // exactly stocked
    await givenProduct('555', 'Milk', 8, 6);     // overstocked

    const body = await (await get('/main')).text();

    assert.match(body, /Eggs/, 'a short item belongs on the list');
    assert.doesNotMatch(body, /Bread/, 'a fully stocked item does not');
    assert.doesNotMatch(body, /Milk/, 'an overstocked item does not');
});

test('the shopping list shows how many are needed', async () => {
    await givenProduct('111', 'Eggs', 4, 12);

    const body = await (await get('/main')).text();

    // 12 desired less 4 held is 8 to buy.
    assert.match(body, /<td>8<\/td>/);
});

test('an empty database renders rather than failing', async () => {
    const response = await get('/main');

    assert.equal(response.status, 200);
    assert.match(await response.text(), /No items in the shopping list/);
});

// ensureLastOrderDate backdates a week on first visit, which is what makes the
// ordering logic do something on a fresh database.
test('a first visit records a last order date a week ago', async () => {
    await get('/main');

    const settings = await db().collection('settings').findOne({ key: 'lastOrderDate' });
    assert.ok(settings, 'a lastOrderDate should have been created');

    const daysAgo = (Date.now() - new Date(settings.lastOrderDate).getTime()) / 86400000;
    assert.ok(daysAgo > 6.9 && daysAgo < 7.1, `expected about 7 days, got ${daysAgo}`);
});

test('a second visit does not move the last order date', async () => {
    await get('/main');
    const first = await db().collection('settings').findOne({ key: 'lastOrderDate' });

    await get('/main');
    const second = await db().collection('settings').findOne({ key: 'lastOrderDate' });

    assert.equal(first.lastOrderDate, second.lastOrderDate);
});

test('placing an order restocks everything that was short', async () => {
    await givenProduct('111', 'Eggs', 4, 12);
    await givenProduct('333', 'Bread', 1, 4);
    await givenProduct('555', 'Milk', 6, 6);

    const response = await postForm('/update-order-date', {});
    assert.equal(response.status, 302);

    assert.equal((await productOf('111')).currentStockLevel, 12);
    assert.equal((await productOf('333')).currentStockLevel, 4);
    assert.equal((await productOf('555')).currentStockLevel, 6, 'already stocked, left alone');
});

test('placing an order moves the last order date to now', async () => {
    await db().collection('settings').insertOne({
        key: 'lastOrderDate',
        lastOrderDate: new Date(Date.now() - 30 * 86400000).toISOString()
    });

    await postForm('/update-order-date', {});

    const settings = await db().collection('settings').findOne({ key: 'lastOrderDate' });
    const secondsAgo = (Date.now() - new Date(settings.lastOrderDate).getTime()) / 1000;
    assert.ok(secondsAgo < 60, `expected a fresh date, got one ${secondsAgo}s old`);
});

test('the shopping list is empty straight after ordering', async () => {
    await givenProduct('111', 'Eggs', 4, 12);

    await postForm('/update-order-date', {});

    assert.match(await (await get('/main')).text(), /No items in the shopping list/);
});

// Regression. An HTML form posts every field as a string. If "5" were stored as a
// string, the $expr comparison that builds the shopping list would compare a string
// against a number and quietly produce the wrong list rather than fail outright.
test('stock levels are stored as numbers, not the strings a form posts', async () => {
    await postForm('/update-stock', {
        itemNo: '111',
        itemName: 'Eggs',
        size: '12 pack',
        desiredStockLevel: '12',
        currentStockLevel: '5'
    });

    const product = await productOf('111');
    assert.strictEqual(product.currentStockLevel, 5);
    assert.strictEqual(product.desiredStockLevel, 12);
    assert.equal(typeof product.currentStockLevel, 'number');
    assert.equal(typeof product.desiredStockLevel, 'number');
});

// The proof that the coercion above matters: numbers that arrived as form strings
// still sort correctly into the shopping list.
test('a product added through the form appears on the shopping list', async () => {
    await postForm('/update-stock', {
        itemNo: '777',
        itemName: 'Coffee',
        size: '250g',
        desiredStockLevel: '10',
        currentStockLevel: '2'
    });

    assert.match(await (await get('/main')).text(), /Coffee/);
});

test('adding a product that does not exist yet creates it', async () => {
    await postForm('/update-stock', {
        itemNo: '888',
        itemName: 'Tea',
        size: '100g',
        desiredStockLevel: '4',
        currentStockLevel: '4'
    });

    assert.ok(await productOf('888'), 'the product should have been inserted');
});

test('updating an existing product overwrites it rather than duplicating', async () => {
    await givenProduct('111', 'Eggs', 4, 12);

    await postForm('/update-stock', {
        itemNo: '111',
        itemName: 'Eggs',
        size: '12 pack',
        desiredStockLevel: '12',
        currentStockLevel: '9'
    });

    assert.equal(await db().collection('items').countDocuments({ itemNo: '111' }), 1);
    assert.equal((await productOf('111')).currentStockLevel, 9);
});

test('my products lists the whole catalogue, short or not', async () => {
    await givenProduct('111', 'Eggs', 4, 12);
    await givenProduct('333', 'Bread', 4, 4);

    const body = await (await get('/my-products')).text();

    assert.match(body, /Eggs/);
    assert.match(body, /Bread/, 'a fully stocked item still belongs in the catalogue');
});

test('my products renders on an empty database', async () => {
    const response = await get('/my-products');

    assert.equal(response.status, 200);
    assert.match(await response.text(), /No products found/);
});
