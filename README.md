# Grocery Management System

An IoT pantry-tracking prototype. A 4×4 keypad wired to an Arduino reports items as they
are used — each product has a 3-digit code — and the system records them in MongoDB Atlas,
tracks stock levels, and builds a shopping list when items run low.

Built as a university IoT project (2024). Currently being extended into a full hardware
prototype — see [Status](#status).

**[Demo video](https://deakin.au.panopto.com/Panopto/Pages/Viewer.aspx?id=6ebda2a1-8227-4fca-a4cf-b1ef00b36d87)**
· [System Architecture Document](System%20Architecture%20Document.pdf)

![System architecture](grocery.drawio.png)

## How it works

The system is four processes connected by a serial port, a JSON file, and a database:

| Stage | Component | What it does |
|---|---|---|
| 1. Enter | `src/arduinoGROCERYPROJ/arduinoGROCERYPROJ.ino` | Reads a 3-digit product code from the keypad, sends it over USB serial on `#`. |
| 2. Capture | `src/newserver/bashservice.sh` | Listens on the serial port, appends `{input, timestamp}` to `data.json`. |
| 3. Persist | `src/newserver/dbservice.js` | Reads `data.json`, inserts records into `grocerydb.groceryitems`. |
| 4. Serve | `src/groceryfrontend/frontserver.js` | Express app on port 4000. Serves the UI, and every 60s processes new scans into stock levels and order suggestions. |

`src/newserver/simulator.js` stands in for the Arduino, so the system can be run and
demonstrated without hardware attached.

The split exists because the scanner is physically tethered to one machine (the "fog node")
while the database and UI are cloud-side. Stages 1–2 run at the edge; stages 3–4 do not
care where the scan came from.

### Data model

MongoDB database `grocerydb`:

- `groceryitems` — raw scans from the Arduino, marked `processed` once consumed.
- `items` — the product catalogue and current stock levels.
- `settings` — application state, including `lastOrderDate`.

## Running it

### Prerequisites

- Node.js 18+
- A MongoDB Atlas cluster (or a local MongoDB)
- `jq` (used by `bashservice.sh`)
- Optional: an Arduino Uno with a 4×4 keypad, running the sketch in
  `src/arduinoGROCERYPROJ/`. Without one, use the simulator.

### 1. Configure

Both services read a `.env` file from their own directory. Create
`src/newserver/.env` and `src/groceryfrontend/.env`:

```
MONGO_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/grocerydb?retryWrites=true&w=majority
CUSTOMER_NUMBER=<the number used to unlock the UI>
PROCESS_INTERVAL_MS=60000
```

`CUSTOMER_NUMBER` and `PROCESS_INTERVAL_MS` are only needed by the frontend. `.env` files
are gitignored and must never be committed.

`PROCESS_INTERVAL_MS` sets how often new scans are turned into stock movements, and
defaults to one minute. That is a sensible pace for a pantry but a tedious one for a
demonstration, so lower it — `PROCESS_INTERVAL_MS=3000` makes the effect of a scan visible
almost immediately.

### 2. Install and start the frontend

```bash
cd src/groceryfrontend
npm install
npm start          # http://localhost:4000
```

### 3. Feed it some scans

With hardware:

```bash
cd src/newserver
npm install
./bashservice.sh   # edit the serial port path inside first — see Known limitations
node dbservice.js  # pushes data.json into MongoDB
```

Without hardware, run the simulator instead of `bashservice.sh`:

```bash
cd src/newserver
npm install
node simulator.js
node dbservice.js
```

Open <http://localhost:4000>, enter the customer number, and the stock list will reflect
the scans.

## Tech stack

- **Hardware** — Elegoo Arduino Uno, 4×4 matrix keypad, USB serial
- **Edge** — Bash, `jq`
- **Backend** — Node.js, Express, MongoDB Atlas driver
- **Frontend** — server-rendered HTML/CSS (no framework)
- **Deployment** — Docker; ran on AWS during the 2024 project, not currently hosted
  (see [Status](#status))

## Repository layout

```
grocery-management-system/
├── src/
│   ├── arduinoGROCERYPROJ/     # Arduino sketch (C++)
│   ├── newserver/              # Edge capture + database service
│   └── groceryfrontend/        # Express app and UI
├── tests/                      # UI test results
├── System Architecture Document.pdf
├── grocery.drawio.png          # Architecture diagram
└── LICENSE.txt                 # MIT
```

## Repository checks

```bash
make check      # refuse to ship if a real credential is in the tree
```

This system holds three kinds of secret at once — a MongoDB Atlas password, cloud
credentials and a TLS key — and a scanner once flagged a connection string in
`src/newserver/.env` before this repository was published. Rather than rely on
remembering, the repository checks itself: `scripts/check-secrets.sh` fails the build if a
`.env`, `.pem`, `.key` or image tarball is tracked, if a MongoDB URI appears with anything
other than a placeholder password, or if an AWS key ID or private key block is committed.

The same script runs in CI on every push and pull request, alongside checks that both
services install cleanly, all JavaScript and shell parses, the sample scan data has the
expected shape, and the services fail closed when no configuration is present.

## Status

This is a **working prototype, not a product.** Known limitations, stated plainly:

- **There is no live deployment.** The system was containerised and run on AWS during the
  2024 project; that instance is gone and nothing here is currently hosted. Treat the AWS
  work as a past exercise, not a running service.
- **The Dockerfile and deployment artefacts are not in this repository.** The `Dockerfile`,
  TLS key and image tarball were gitignored, so the container is not reproducible from this
  repo alone. Re-adding a clean, committed Dockerfile is the next planned change.
- **Scans are discarded if the product does not exist yet.** The processing loop marks a
  scan as processed whether or not a matching item is in the catalogue, so codes scanned
  before the product is added are consumed and lost. Add products on the update-stock page
  first, then scan.
- **The serial port path is hardcoded** to `/dev/cu.usbmodem146201` in `bashservice.sh`.
  It must be edited to match your machine.
- **`dbservice.js` is run manually** and prompts before clearing `data.json`; it is not a
  scheduled service.
- **Authentication is a single shared customer number**, not real user accounts.
- **`tests/` contains recorded UI test results, not an automated test suite.** There is no
  `npm test`.

## Development notes

The system was designed and built by me in 2024 as a university IoT project. The 2026
cleanup — the documentation, the secret-scanning check, the CI workflow, and fixes to the
configuration handling and simulator — was carried out with the assistance of an AI coding
assistant (Claude). The design, the architectural decisions, the scope of what to change and
what to preserve, and the review of all resulting work are my own.

## License

MIT — see [LICENSE.txt](LICENSE.txt).
