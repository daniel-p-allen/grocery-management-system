const fs = require('fs');
const readline = require('readline');

// Create an interface for asking user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to save a 3-digit number with an adjusted timestamp
function saveNumberToFile(number, timeAdjustment) {
    const filePath = './data.json';

    // Create the current date and apply the time adjustment (into the past)
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - timeAdjustment);  // Subtract the days for adjustment
    const adjustedTimestamp = currentDate.toISOString();  // ISO 8601 format

    // Read the existing data from the JSON file
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('\nError reading file:', err);
            return;
        }

        // Parse the existing data as a JavaScript array
        let jsonData = JSON.parse(data);

        // Append the new number and adjusted timestamp
        jsonData.push({ 
            "input": number.toString(),
            "timestamp": adjustedTimestamp
        });

        // Write the updated data back to the file
        fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), (err) => {
            if (err) {
                console.error('\nError writing to file:', err);
            } else {
                console.log(`\nNumber ${number} with adjusted timestamp saved to data.json\n`);
                promptForInput();  // Ask for the next number after writing to file
            }
        });
    });
}

// Function to prompt for input and handle repeated inputs
function promptForInput() {
    rl.question('\nPlease enter a 3-digit number or type "exit" to quit: ', (numberInput) => {
        if (numberInput.toLowerCase() === 'exit') {
            console.log('\nExiting...\n');
            rl.close();
            return;
        }

        if (numberInput.length === 3 && /^\d+$/.test(numberInput)) {
            rl.question('\nHow many days in the past do you want to adjust the timestamp? ', (daysInput) => {
                const days = parseInt(daysInput);
                if (!isNaN(days) && days >= 0) {
                    saveNumberToFile(numberInput, days);
                } else {
                    console.log('\nInvalid input. Please enter a valid number of days.');
                    promptForInput();  // Ask for the next number
                }
            });
        } else {
            console.log('\nInvalid input. Please enter a 3-digit number.');
            promptForInput();  // Ask for the next number
        }
    });
}

// Start the process
promptForInput();
