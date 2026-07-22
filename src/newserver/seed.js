// Populate an empty database with a small pantry so the system has something to show.
//
// Without this, a fresh database renders an empty page: the catalogue is built up as
// products are added through the UI, so there is nothing to see until someone types.
//
// Order matters. The processing loop marks a scan as processed whether or not a matching
// product exists, so scans inserted before the catalogue would be consumed and lost. The
// catalogue is written first for that reason.
//
// Running this twice is safe, and that matters more than it looks: compose restarts the
// seed whenever the frontend is rebuilt. An earlier version upserted the stock levels with
// $set, which reset every product to its starting quantity on the second run while the
// scans, already present, were not reprocessed — leaving a full pantry and an empty
// shopping list. So this seeds only what is missing and never overwrites live stock.

require('dotenv').config();

const { MongoClient } = require('mongodb');
const sampleScans = require('./data.json');

const mongoUrl = process.env.MONGO_URL;

if (!mongoUrl) {
    console.error('MONGO_URL is not set. See the README.');
    process.exit(1);
}

// Product codes match the scans in data.json, so the seeded scans have somewhere to land.
const pantry = [
    { itemNo: '111', itemName: 'Eggs',   size: '12 pack', desiredStockLevel: 12, currentStockLevel: 12 },
    { itemNo: '333', itemName: 'Bread',  size: '700g',    desiredStockLevel: 4,  currentStockLevel: 4 },
    { itemNo: '555', itemName: 'Milk',   size: '2L',      desiredStockLevel: 6,  currentStockLevel: 6 },
    { itemNo: '777', itemName: 'Coffee', size: '250g',    desiredStockLevel: 3,  currentStockLevel: 3 }
];

async function seed() {
    const client = new MongoClient(mongoUrl);

    try {
        await client.connect();
        const db = client.db('grocerydb');

        const now = new Date().toISOString();

        // $setOnInsert, not $set: a product that is already there keeps whatever stock
        // level the system has moved it to.
        let inserted = 0;

        for (const item of pantry) {
            const result = await db.collection('items').updateOne(
                { itemNo: item.itemNo },
                { $setOnInsert: { ...item, lastUpdated: now } },
                { upsert: true }
            );
            if (result.upsertedCount) inserted += 1;
        }

        console.log(
            inserted
                ? `Seeded ${inserted} product(s).`
                : `All ${pantry.length} products already present; stock left untouched.`
        );

        const existingScans = await db.collection('groceryitems').countDocuments();

        if (existingScans === 0) {
            await db.collection('groceryitems').insertMany(
                sampleScans.map(scan => ({ ...scan, processed: false }))
            );
            console.log(`Seeded ${sampleScans.length} scans; stock will fall as they are processed.`);
        } else {
            console.log(`Left ${existingScans} existing scan(s) alone.`);
        }

        // The frontend backdates this to a week ago on first run if it is missing, which
        // is what makes the ordering logic do something on a fresh database.
        await db.collection('settings').updateOne(
            { key: 'lastOrderDate' },
            { $setOnInsert: { lastOrderDate: new Date(Date.now() - 7 * 864e5).toISOString() } },
            { upsert: true }
        );

        console.log('Seed complete.');
    } finally {
        await client.close();
    }
}

seed().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
