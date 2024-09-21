#include <Keypad.h>

const byte ROWS = 4; // Four rows
const byte COLS = 4; // Four columns

// Correct Number Pad
char keys[ROWS][COLS] = {
  {'D', 'C', 'B', 'A'},  
  {'#', '9', '6', '3'}, 
  {'0', '8', '5', '2' },  
  {'*', '7', '4', '1' }   
};

// Wire connections for the keypad
byte rowPins[ROWS] = {9, 8, 7, 6}; // Connect to the row pinouts of the keypad
byte colPins[COLS] = {5, 4, 3, 2}; // Connect to the column pinouts of the keypad

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

String inputNumber = ""; // Variable to store the number sequence

void setup() {
  Serial.begin(9600);
}

void loop() {
  char key = keypad.getKey();

  if (key) {
    if (key == '#') {
      // Only send the input if it's exactly 3 digits long
      if (inputNumber.length() == 3) {
        Serial.println(inputNumber); // Send only the final three-digit number
        delay(100); // Short delay to ensure data transmission is complete
      }
      inputNumber = ""; // Reset the inputNumber variable for the next sequence
    } else if (isDigit(key)) {
      // Append the key to the inputNumber string if it's a digit
      inputNumber += key;
    }
  }
}
