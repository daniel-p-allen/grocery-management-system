require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const port = 4000;  // Using port 4000 as chosen
const mongoUrl = process.env.MONGO_URL;  // MongoDB connection string from .env
const validCustomerNumber = process.env.CUSTOMER_NUMBER; 

let db;
let settingsCollection;
let itemsCollection;
let groceryItemsCollection;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Connect to MongoDB
MongoClient.connect(mongoUrl, { useUnifiedTopology: true })
    .then(client => {
        db = client.db('grocerydb');
        settingsCollection = db.collection('settings');       // Application settings
        itemsCollection = db.collection('items');             // Grocery items
        groceryItemsCollection = db.collection('groceryitems'); // Arduino data
        console.log('Connected to MongoDB');

        // Start the periodic processing of grocery items
        setInterval(processNewGroceryItems, 60000); // Runs every 60 seconds
    })
    .catch(error => console.error(error));

// Function to ensure there's a lastOrderDate in the settings collection
async function ensureLastOrderDate() {
    const settings = await settingsCollection.findOne({ key: 'lastOrderDate' });
    if (!settings) {
        // If no lastOrderDate exists, set it to 1 week ago
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        await settingsCollection.insertOne({
            key: 'lastOrderDate',
            lastOrderDate: oneWeekAgo.toISOString()
        });
        console.log('Inserted lastOrderDate as 1 week ago.');
    }
}

// Function to process new grocery items from the 'groceryitems' collection
// Function to process new grocery items from the 'groceryitems' collection
async function processNewGroceryItems() {
    try {
        console.log('Starting processNewGroceryItems function...');

        // Query for unprocessed records where 'processed' is false or doesn't exist
        const unprocessedRecords = await groceryItemsCollection.find({
            $or: [
                { processed: false },
                { processed: { $exists: false } }
            ]
        }).toArray();
        console.log(`Found ${unprocessedRecords.length} unprocessed record(s).`);

        for (const record of unprocessedRecords) {
            try {
                console.log(`Processing record with _id: ${record._id}`);

                // Extract input directly from the record
                const { input } = record;

                // Directly use the input as the itemNo (since it's a string)
                let itemNo = input;

                // Log extracted data
                console.log('Extracted Data:', { itemNo });

                // Check if itemNo is valid
                if (!itemNo) {
                    console.error(`Error: 'input' is missing in record with _id: ${record._id}`);
                    // Mark the record as processed despite the error
                    await groceryItemsCollection.updateOne(
                        { _id: record._id },
                        { $set: { processed: true } }
                    );
                    continue; // Skip to the next record
                }

                // Find the item in the 'items' collection
                const item = await itemsCollection.findOne({ itemNo });

                if (!item) {
                    console.error(`Error: No item found in 'items' collection with itemNo: ${itemNo}`);
                    // Mark the record as processed despite the error
                    await groceryItemsCollection.updateOne(
                        { _id: record._id },
                        { $set: { processed: true } }
                    );
                    continue; // Skip to the next record
                }

                // Decrement the currentStockLevel by 1
                const newStockLevel = Number(item.currentStockLevel) - 1;

                // Ensure stock level doesn't go negative
                const updatedStockLevel = newStockLevel >= 0 ? newStockLevel : 0;

                // Update the item's current stock level in the database
                const updateResult = await itemsCollection.updateOne(
                    { itemNo },
                    {
                        $set: {
                            currentStockLevel: updatedStockLevel,
                            lastUpdated: new Date().toISOString()
                        }
                    }
                );

                console.log(`Updated itemsCollection for itemNo: ${itemNo}`, {
                    matchedCount: updateResult.matchedCount,
                    modifiedCount: updateResult.modifiedCount
                });

                // Mark the record as processed
                await groceryItemsCollection.updateOne(
                    { _id: record._id },
                    { $set: { processed: true } }
                );

                console.log(`Marked record with _id: ${record._id} as processed.`, {
                    matchedCount: 1,
                    modifiedCount: 1
                });
            } catch (recordError) {
                console.error(`Error processing record with _id: ${record._id}:`, recordError);

                // Mark the record as processed despite the error
                await groceryItemsCollection.updateOne(
                    { _id: record._id },
                    { $set: { processed: true } }
                );
            }
        }

        if (unprocessedRecords.length > 0) {
            console.log(`Finished processing ${unprocessedRecords.length} new grocery item(s).`);
        } else {
            console.log('No new grocery items to process.');
        }
    } catch (error) {
        console.error('Error in processNewGroceryItems function:', error);
    }
}



// Route to authenticate the customer number without checking MongoDB
app.post('/authenticate', (req, res) => {
    const customerNumber = req.body.customerNumber;
    if (customerNumber === validCustomerNumber) {
        res.redirect('/main');
    } else {
        // Display the "not authenticated" page with the same styling and logo
        let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <!-- [head contents remain the same] -->
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Authentication Error</title>
            <link rel="stylesheet" href="styles.css">
            <style>
                .error-message {
                    text-align: center;
                    color: red;
                    font-size: 20px;
                    margin: 20px 0;
                }
                .container {
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <!-- [body contents remain the same] -->
            <div class="container">
                <img src="/logo.jpg" alt="Logo" style="width: 150px; height: auto; display: block; margin: 0 auto;">
                <br><br><br>
                <h1>Authentication Error</h1>
                <p class="error-message">Sorry, you are not authenticated.</p>
                <a href="/" class="button" style="background-color: #4CAF50; color: white; padding: 10px 20px; border-radius: 5px;">Try Again</a>
            </div>
        </body>
        </html>
        `;
        res.send(html);  // Send the dynamically generated HTML for authentication error
    }
});

// Serve the main page with the shopping list
app.get('/main', async (req, res) => {
    await ensureLastOrderDate();  // Ensure there is a lastOrderDate in the settings collection

    const settings = await settingsCollection.findOne({ key: 'lastOrderDate' });
    const lastOrderDate = settings ? new Date(settings.lastOrderDate) : new Date(0);  // Default to far past if no order date exists

    // Fetch items where currentStockLevel is less than desiredStockLevel
    const shoppingList = await itemsCollection.find({
        $expr: { $lt: ["$currentStockLevel", "$desiredStockLevel"] } // Items where currentStockLevel < desiredStockLevel
    }).toArray();

    // Calculate and update each item with the quantity needed (updatedQty)
    const updatedShoppingList = shoppingList.map(item => {
        const updatedQty = Number(item.desiredStockLevel) - Number(item.currentStockLevel);  // Calculate the quantity needed
        return { ...item, updatedQty };  // Add the updatedQty to the item
    });

    // Generate the HTML with a table layout for the shopping list
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <!-- [head contents remain the same] -->
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PL Grocery Manager</title>
        <link rel="stylesheet" href="styles.css">
        <style>
            table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 20px;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            th {
                background-color: #f2f2f2;
                font-weight: bold;
            }
            .button {
                background-color: #4CAF50;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                text-decoration: none;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <!-- Add the logo dynamically generated at the top -->
            <img src="/logo.jpg" alt="Logo" style="width: 150px; height: auto; float: left; display: block; margin: 0 auto;">
            <br><br><br><br><br><br><br><br><br>
            <h1>PL Grocery Manager</h1>
            <!-- Add Products Button aligned to the right -->
            <a href="/update-stock.html" class="button" style="float: right; margin-bottom: 20px; margin-left: 10px;">Add Products</a>
            <!-- My Products Button under Add Products -->
            <a href="/my-products" class="button" style="float: right; margin-bottom: 20px;">My Products</a>
            <!-- Clear floats -->
            <div style="clear: both;"></div>
            <!-- Display the Last Order Date -->
            <p><strong>Last Order Date:</strong> ${settings ? settings.lastOrderDate : 'No orders yet'}</p>
            <br><br>
            <!-- Current Shopping List -->
            <h2>Current Shopping List</h2>
            <table>
                <thead>
                    <tr>
                        <th>Item No</th>
                        <th>Item Name</th>
                        <th>Size/Weight</th>
                        <th>Quantity Needed</th>
                    </tr>
                </thead>
                <tbody>
    `;

    // If the shopping list is empty, display a placeholder message
    if (updatedShoppingList.length === 0) {
        html += `<tr><td colspan="4">No items in the shopping list</td></tr>`;
    } else {
        // Display each item in the shopping list in table rows
        updatedShoppingList.forEach(item => {
            html += `
                <tr>
                    <td>${item.itemNo}</td>
                    <td>${item.itemName}</td>
                    <td>${item.size}</td>
                    <td>${item.updatedQty}</td>
                </tr>
            `;
        });
    }

    // Close the table and add the Order button
    html += `
                </tbody>
            </table>
            <!-- Order Button -->
            <form action="/update-order-date" method="POST">
                <button type="submit" class="button" style="width: 100%; padding: 15px;">Order</button>
            </form>
        </div>
    </body>
    </html>
    `;

    res.send(html);  // Send the dynamically generated HTML
});

// New route to display the user's products
app.get('/my-products', async (req, res) => {
    // Fetch all items from the items collection
    const products = await itemsCollection.find({}).toArray();

    // Generate the HTML with a table layout for the products
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <!-- [head contents similar to main page] -->
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>My Products - PL Grocery Manager</title>
        <link rel="stylesheet" href="styles.css">
        <style>
            table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 20px;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            th {
                background-color: #f2f2f2;
                font-weight: bold;
            }
            .button {
                background-color: #4CAF50;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                text-decoration: none;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <!-- Add the logo -->
            <img src="/logo.jpg" alt="Logo" style="width: 150px; height: auto; float: left; display: block;">
            <br><br><br><br><br><br><br>
            <h1 style="margin-left: 160px;">Grocery Management Screen</h1>
            <!-- Back to Main Button -->
            
            <a href="/main" class="button">Back to Main</a>
            <br><br><br>
            <!-- Products Table -->
            <table>
                <thead>
                    <tr>
                        <th>Item No</th>
                        <th>Item Name</th>
                        <th>Size/Weight</th>
                        <th>Current Stock Level</th>
                        <th>Desired Stock Level</th>
                    </tr>
                </thead>
                <tbody>
    `;

    // If there are no products, display a placeholder message
    if (products.length === 0) {
        html += `<tr><td colspan="5">No products found</td></tr>`;
    } else {
        // Display each product in the table
        products.forEach(item => {
            html += `
                <tr>
                    <td>${item.itemNo}</td>
                    <td>${item.itemName}</td>
                    <td>${item.size}</td>
                    <td>${item.currentStockLevel}</td>
                    <td>${item.desiredStockLevel}</td>
                </tr>
            `;
        });
    }

    // Close the table and div
    html += `
                </tbody>
            </table>
        </div>
    </body>
    </html>
    `;

    res.send(html);  // Send the dynamically generated HTML
});

// Route to update the last order date and replenish stock levels
app.post('/update-order-date', async (req, res) => {
    try {
        // Fetch the lastOrderDate from the settings collection
        const settings = await settingsCollection.findOne({ key: 'lastOrderDate' });
        const lastOrderDate = settings ? new Date(settings.lastOrderDate) : new Date(0);  // Default to a very old date if no lastOrderDate exists

        // Fetch items that need to be restocked (current stock is less than desired stock)
        const shoppingList = await itemsCollection.find({
            $expr: { $lt: ["$currentStockLevel", "$desiredStockLevel"] } // Use $expr to compare fields
        }).toArray();

        // Update the stock levels for each item in the shopping list
        for (const item of shoppingList) {
            const quantityNeeded = Number(item.desiredStockLevel) - Number(item.currentStockLevel);  // Calculate how much is needed
            const newStockLevel = Number(item.currentStockLevel) + quantityNeeded;  // Add the quantity needed to the current stock

            // Update the item's current stock level in the database
            await itemsCollection.updateOne(
                { itemNo: item.itemNo },
                {
                    $set: {
                        currentStockLevel: newStockLevel,  // Update the stock level
                        lastUpdated: new Date().toISOString()  // Update the last updated timestamp
                    }
                }
            );
        }

        // Now update the lastOrderDate after stock levels have been adjusted
        const currentDate = new Date().toISOString();
        await settingsCollection.updateOne(
            { key: 'lastOrderDate' },
            { $set: { lastOrderDate: currentDate } },
            { upsert: true }
        );

        // Redirect back to the main page
        res.redirect('/main');
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).send('Error updating order');
    }
});

// POST endpoint for updating stock
app.post('/update-stock', async (req, res) => {
    const { itemNo, itemName, size, desiredStockLevel, currentStockLevel } = req.body;
    const currentDate = new Date().toISOString();

    const updateDoc = {
        $set: {
            itemName,
            size,
            desiredStockLevel: Number(desiredStockLevel),
            currentStockLevel: Number(currentStockLevel),  // Ensure this is stored as a number
            lastUpdated: currentDate
        }
    };

    // Update the item in the 'items' collection
    await itemsCollection.updateOne({ itemNo }, updateDoc, { upsert: true });
    res.redirect('/main');  // Redirect to main page to see the updated list
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
