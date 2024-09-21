// Load environment variables from .env
require('dotenv').config(); // for future reference this must be at the top

const fs = require('fs');
const { MongoClient } = require('mongodb');
const readline = require('readline');

// Check if MongoDB URL is loaded correctly
const mongoUrl = process.env.MONGO_URL;
console.log("MongoDB URL:", mongoUrl);

// MongoDB client initialization
let client;

try {
    // Create a new MongoDB client
    client = new MongoClient(mongoUrl);
} catch (error) {
    console.error("Error creating MongoClient:", error);
    process.exit(1);  // Exit if there's an issue with creating the client
}

// Path to the JSON file
const jsonFilePath = './data.json';

// Create an interface for asking user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to ask if the JSON file should be deleted
function askToDeleteJson() {
    rl.question('\nDo you want to delete the information in the JSON file? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes') {
            fs.writeFile(jsonFilePath, '[]', (err) => {  // Clear the file by writing an empty array
                if (err) {
                    console.error('Error clearing the JSON file:', err);
                } else {
                    console.log('JSON file cleared.');
                }
                rl.close();
            });
        } else {
            console.log('JSON file was not cleared.');
            rl.close();
        }
    });
}

// Function to read the JSON file and send data to MongoDB
async function processJsonAndSendToDB() {
    // Check if the JSON file exists
    if (!fs.existsSync(jsonFilePath)) {
        console.log(`JSON file not found at ${jsonFilePath}. Please make sure the file exists before running the script.`);
        return; // Exit the function if the file doesn't exist
    }

    let savedNumbers = []; // Array to store successfully saved numbers

    try {
        await client.connect();  // Connect to MongoDB
        console.log("Connected to MongoDB successfully!");

        // Read the JSON file
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        const dataArray = JSON.parse(jsonData);

        if (dataArray.length === 0) {
            console.log("No data to process.");
            return;
        }

        const db = client.db("grocerydb");
        const collection = db.collection("groceryitems");

        // Insert each JSON object into the MongoDB collection as is
        for (const data of dataArray) {
            const result = await collection.insertOne(data);
            console.log(`Data inserted with ID: ${result.insertedId}`);

            // Save the input number to the array
            savedNumbers.push(data.input);
        }

        console.log("All data processed and sent to MongoDB.");

        // Output the list of all successfully saved numbers
        console.log("Successfully saved numbers:");
        console.log(savedNumbers.join(', '));

        // Ask if the JSON file should be deleted
        askToDeleteJson();

    } catch (err) {
        console.error("Error processing JSON or sending data to MongoDB:", err);
    } finally {
        await client.close();  // Ensure the client is closed when done
    }
}

processJsonAndSendToDB();
