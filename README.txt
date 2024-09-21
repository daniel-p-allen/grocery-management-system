
# Grocery Management System - Much more info in the /docs/System Architecture Document.pdf

## Project Overview
The **Grocery Management System** automates the management of grocery stock, keeping track of items removed from shelves, and generating a shopping list when stock is low. The system uses an Arduino to scan items and updates a MongoDB database, with cloud-based processing.

## Features
- Track grocery items using an Arduino-based scanner.
- Cloud-based stock tracking with MongoDB Atlas.
- Automatic stock updates when an order is placed.
- Responsive user interface for entering customer numbers, adding products, and viewing stock lists.

## Tech Stack
- **Hardware**: Elegoo Arduino Uno
- **Backend**: Node.js, Express, MongoDB Atlas
- **Frontend**: HTML, CSS
- **Cloud**: Dockerized system on AWS
- **Languages**: Arduino C++, JavaScript

## Installation

1. Install dependencies:
Once the repository is cloned, navigate to the project folder and install the dependencies using npm:

```
npm install
```

2. Set up MongoDB:
- Use your own MongoDB Atlas instance or set up MongoDB locally.
- Collections required: `grocerydb.groceryitems` and `grocerydb.settings`.
- **Important**: Ensure your MongoDB credentials are stored securely in environment variables. Replace any hardcoded credentials in your code with the following placeholder:

```javascript
const mongoURI = process.env.MONGO_URI || 'mongodb+srv://username:<password>@cluster.mongodb.net/myDB?retryWrites=true&w=majority';
```

3. Run the server:
Start the server by using the following command:

```
npm start
```

## Usage
1. Connect the Arduino device to your Fog Node (simulated) it was usb on my laptop.
2. 
2. Enter a customer number on the splash screen to authenticate.
3. View the current stock and enter items to track directly from the app.
4. The program will update stock levels and track orders in MongoDB.

## Demo Video
Watch the [Demo Video](https://deakin.au.panopto.com/Panopto/Pages/Viewer.aspx?id=6ebda2a1-8227-4fca-a4cf-b1ef00b36d87) for a full demonstration of the system in action.

## File Structure
```
grocery-management-system/
├── src/                   # Source code for the system
├── docs/                  # Documentation like UML diagrams, technical details
├── tests/                 # Test files
├── README.md              # Project overview and instructions
├── .gitignore             # Files and directories to be ignored by Git
├── LICENSE                # License file
```

## Documentation
See the `/docs` folder for:
- UML diagrams
- Technical documentation
- System architecture

## License
This project is licensed under the MIT License.
