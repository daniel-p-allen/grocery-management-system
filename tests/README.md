# Tests

Automated tests for the grocery management system.

## Running them

From the repository root:

```bash
make test
```

That installs what each service needs, installs the test dependencies, and runs the
suite. Nothing else has to be set up first — **no Docker, no Colima, no MongoDB Atlas
account, no `.env` file**.

To run them from this directory instead, or to run a single file while working on it:

```bash
cd tests
npm install
npm test                          # everything
node --test pipeline.test.js      # one file
node --test --test-name-pattern="stock" # tests whose name matches
```

### Requirements

Node 20 or newer. The first run downloads a MongoDB binary (about 70 MB) and caches
it in `~/.cache/mongodb-binaries`, so the first run is slower than the rest.

## How they work

These are **black-box** tests. They do not import the application — they start it,
exactly as `npm start` does, as a real operating system process, and then drive it
from the outside: over HTTP for the web app, over stdin for the command-line tools.
What they assert on is what actually landed in the database or on disk.

That choice was deliberate. Testing the code directly would have meant adding exports
and splitting files up to create seams for the tests to reach into — reshaping the
application to suit its tests. Doing it from outside means **nothing under `src/` had
to change**, and what gets tested is the real system: the real Express routes, the
real Mongo driver, the real queries.

It works because the services are already configurable from outside:

| Variable | What the tests use it for |
|---|---|
| `MONGO_URL` | Point each service at a throwaway database |
| `CUSTOMER_NUMBER` | Drive the login both ways |
| `PROCESS_INTERVAL_MS` | Turn the 60-second scan timer down to 300ms, or off entirely |

`mongodb-memory-server` provides a real MongoDB that runs in memory and is thrown
away afterwards. The queries under test use `$expr`, `$setOnInsert` and upserts, so a
hand-written fake database would prove nothing.

### The trade-offs

Worth knowing, because they are real:

- **Slower than unit tests** — seconds rather than milliseconds, because a real
  server starts.
- **Blunter failures** — "the shopping list omitted Milk" rather than "this function
  returned 3." You get told what broke, and then you go and look.
- **One at a time** — the port is hardcoded to 4000, so test files run sequentially
  (`--test-concurrency=1`).

## What is here

| File | Covers |
|---|---|
| `helpers/harness.js` | Starting MongoDB and the services, driving them, cleaning up |
| `pipeline.test.js` | Turning scans into stock levels — the background timer |
| `routes.test.js` | The web routes: login, shopping list, ordering, adding stock |
| `seed.test.js` | Seeding a pantry, and being safe to run twice |
| `simulator.test.js` | Entering codes by hand with no hardware attached |
| `dbservice.test.js` | Moving captured scans into the database |
| `UI Test Results.pdf` | Manual UI testing from the original 2024 project, kept as a record |

## Why particular tests exist

Several pin defects that were found and fixed. A fix without a test is a fix that
comes back:

| Test | The defect it holds shut |
|---|---|
| seeding twice does not reset stock that has moved | Seeding used `$set`, resetting every product to its starting quantity on the second run — leaving a full pantry and an empty shopping list |
| the password is not leaked when the connection string is rejected | The connection string, which carries the database password, was once printed on startup |
| a missing data.json is created rather than hung on | The simulator hung on a clean checkout, so the first thing a new user tried appeared to freeze |
| no database URL is refused with an explanation, not a stack trace | Services crashed with a driver stack trace instead of saying what was missing |
| stock stops at zero rather than going negative | Negative stock would read as a shortfall forever |
| a scan for an unknown product is marked processed instead of retried forever | Otherwise the same record is retried on every tick, for the life of the process |
| stock levels are stored as numbers, not the strings a form posts | A stock level stored as `"5"` breaks the `$expr` comparison that builds the shopping list, quietly and without an error |

## Writing a new test

1. Pick the file that matches what you are testing, or add one ending in `.test.js`.
2. Use the `before` / `after` / `beforeEach` hooks from an existing file — they start
   the database, start the service, and reset state between tests.
3. Set up state by writing to the database through `db()`, drive the system with
   `get()` / `postForm()` or `runInteractive()`, then assert on the result.
4. For anything the background timer does, use `waitFor()` — it polls until the
   condition holds rather than guessing at a sleep.

If a test seems to need a change to something under `src/`, that is a signal to
reconsider the test, not the application.

## Proving the tests are worth having

A test suite that has only ever passed proves nothing. These were checked by
reintroducing each fixed defect, one at a time, in a scratch copy of the repository
and confirming the matching test failed. See the Tests section of the root
[`README.md`](../README.md) for the results.
