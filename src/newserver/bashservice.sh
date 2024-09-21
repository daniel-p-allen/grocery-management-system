#!/bin/bash

# with timestamp


# Path to the JSON file
JSON_FILE="data.json"

# Print a message indicating the script is starting
echo "Listening on /dev/cu.usbmodem146201..."

# Check if the JSON file exists
if [ ! -f "$JSON_FILE" ]; then
    # If the file doesn't exist, create it with an empty array
    echo "File $JSON_FILE not found. Creating $JSON_FILE with an empty array."
    echo "[]" > "$JSON_FILE"
else
    echo "File $JSON_FILE already exists. Proceeding to append data."
fi

# Read from the serial port and process data
while IFS= read -r line
do
    # Assuming each line is a valid number or set of digits
    if [[ $line =~ ^[0-9]+$ ]]; then
        echo "Received: $line"

        # Get the current timestamp in ISO 8601 format
        timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

        # Create a JSON object with the number and timestamp
        json_object="{\"input\":\"$line\", \"timestamp\":\"$timestamp\"}"

        # Append the JSON object to the file
        jq ". += [$json_object]" "$JSON_FILE" > tmp.$$.json && mv tmp.$$.json "$JSON_FILE"

        # Confirm that the JSON file has been updated
        if [ $? -eq 0 ]; then
            echo "Successfully updated $JSON_FILE with: $json_object"
            echo "Numbers and timestamp saved."
        else
            echo "Failed to update $JSON_FILE"
        fi
    fi
done < /dev/cu.usbmodem146201  # Replace with your actual serial port

