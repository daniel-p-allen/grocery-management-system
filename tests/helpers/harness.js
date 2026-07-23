// Test harness.
//
// The services are not modified to make them testable. Nothing in src/ exports
// anything, and running any of those files starts a server or a prompt — so the
// tests treat them the way a user does: start them as real processes, point them
// at a throwaway database through the environment, and watch what happens.
//
// That works because the services are already configurable from outside:
//   MONGO_URL            where to connect
//   CUSTOMER_NUMBER      the number that unlocks the UI
//   PROCESS_INTERVAL_MS  how often scans are turned into stock levels
//
// dotenv does not overwrite variables that are already set, so a .env file in the
// working tree cannot interfere with what is passed in here.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const REPO = path.resolve(__dirname, '..', '..');

const SERVICES = {
    frontserver: path.join(REPO, 'src', 'groceryfrontend', 'frontserver.js'),
    dbservice: path.join(REPO, 'src', 'newserver', 'dbservice.js'),
    seed: path.join(REPO, 'src', 'newserver', 'seed.js'),
    simulator: path.join(REPO, 'src', 'newserver', 'simulator.js')
};

const DB_NAME = 'grocerydb';
const PORT = 4000; // hardcoded in frontserver.js, so one server at a time
const BASE_URL = `http://localhost:${PORT}`;

let mongod;
let client;

// A real MongoDB, in memory, thrown away at the end. The services connect to it
// exactly as they would to Atlas — the queries under test use $expr, $setOnInsert
// and upserts, so a hand-written fake would prove nothing.
async function startMongo() {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();

    client = new MongoClient(uri);
    await client.connect();

    return uri + DB_NAME;
}

async function stopMongo() {
    if (client) await client.close();
    if (mongod) await mongod.stop();
    client = undefined;
    mongod = undefined;
}

function db() {
    return client.db(DB_NAME);
}

// Between tests, so the order they run in can never matter.
async function resetDb() {
    const collections = await db().collections();
    for (const collection of collections) {
        await collection.deleteMany({});
    }
}

// The services resolve their dependencies relative to their own directory, so they
// can be run from anywhere. Tests that write files (simulator.js and dbservice.js
// both use './data.json') are given a temporary working directory, which keeps the
// repository's own data.json untouched.
function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-test-'));
}

function baseEnv(mongoUrl, extra = {}) {
    return {
        ...process.env,
        MONGO_URL: mongoUrl,
        CUSTOMER_NUMBER: '1234',
        ...extra
    };
}

// Start a long-running service and wait until it is actually ready. Returns a
// handle that captures everything it printed and can stop it again.
//
// readyText matters: frontserver prints "Server running" from app.listen before the
// database connection resolves, and its routes need the collections that are only
// assigned once it has. Waiting for the connection line avoids a race that would
// otherwise show up as rare, confusing failures.
function startService(name, { env = {}, cwd, readyText = 'Connected to MongoDB', timeoutMs = 30000 } = {}) {
    const child = spawn(process.execPath, [SERVICES[name]], {
        cwd: cwd || path.dirname(SERVICES[name]),
        env
    });

    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });

    const handle = {
        child,
        get output() { return output; },
        async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill('SIGTERM');
            await new Promise(resolve => {
                const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
                child.once('exit', () => { clearTimeout(timer); resolve(); });
            });
        }
    };

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            handle.stop();
            reject(new Error(`${name} did not become ready in ${timeoutMs}ms. Output:\n${output}`));
        }, timeoutMs);

        const check = () => {
            if (output.includes(readyText)) {
                clearTimeout(timer);
                resolve(handle);
            }
        };

        child.stdout.on('data', check);
        child.stderr.on('data', check);

        child.once('exit', code => {
            clearTimeout(timer);
            if (!output.includes(readyText)) {
                reject(new Error(`${name} exited with code ${code} before becoming ready. Output:\n${output}`));
            }
        });

        child.once('error', error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

// Run a script that is meant to finish on its own, optionally feeding it stdin.
// seed.js exits by itself; simulator.js and dbservice.js sit on a readline prompt
// until they are told what to do.
function runToCompletion(name, { env = {}, cwd, stdin = '', timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SERVICES[name]], {
            cwd: cwd || path.dirname(SERVICES[name]),
            env
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${name} did not finish in ${timeoutMs}ms. Output:\n${stdout}${stderr}`));
        }, timeoutMs);

        child.once('exit', code => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, output: stdout + stderr });
        });

        child.once('error', error => {
            clearTimeout(timer);
            reject(error);
        });

        if (stdin) child.stdin.write(stdin);
        child.stdin.end();
    });
}

// Drive a script that asks questions, answering one prompt at a time.
//
// Writing every answer at once and closing stdin does not work: readline delivers
// the queued lines immediately, but simulator.js only asks its next question after
// an asynchronous file write has finished. By then stdin has ended, readline has
// closed, and the next question throws ERR_USE_AFTER_CLOSE. A person typing never
// hits this because they cannot answer a question that has not been asked yet.
//
// So each answer is held back until the prompt that asks for it has appeared, and
// stdin is left open — the script ends itself.
function runInteractive(name, { env = {}, cwd, lines = [], prompts, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SERVICES[name]], {
            cwd: cwd || path.dirname(SERVICES[name]),
            env
        });

        let stdout = '';
        let stderr = '';
        let sent = 0;

        const promptCount = () =>
            prompts.reduce((total, prompt) => total + (stdout.split(prompt).length - 1), 0);

        // Send the next answer once its question has actually been asked. Once every
        // answer is in, close stdin — readline holds the process open otherwise, and
        // by this point no further question can be pending.
        const pump = () => {
            while (sent < lines.length && promptCount() > sent) {
                child.stdin.write(lines[sent] + '\n');
                sent += 1;
            }
            if (sent === lines.length && !child.stdin.writableEnded) {
                child.stdin.end();
            }
        };

        child.stdout.on('data', chunk => { stdout += chunk; pump(); });
        child.stderr.on('data', chunk => { stderr += chunk; });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(
                `${name} did not finish in ${timeoutMs}ms after ${sent}/${lines.length} answers.` +
                `\nOutput:\n${stdout}${stderr}`
            ));
        }, timeoutMs);

        child.once('exit', code => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, output: stdout + stderr });
        });

        child.once('error', error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

// Poll until a condition holds. The scan pipeline runs on a timer rather than on
// demand, so tests have to wait for it rather than call it.
async function waitFor(condition, { timeoutMs = 15000, intervalMs = 100, description = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const result = await condition();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
}

// Post a form the way the HTML pages do — urlencoded, and without following the
// redirect, so tests can assert on where it was sent.
function postForm(pathname, fields) {
    return fetch(BASE_URL + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual'
    });
}

function get(pathname) {
    return fetch(BASE_URL + pathname, { redirect: 'manual' });
}

module.exports = {
    BASE_URL,
    DB_NAME,
    SERVICES,
    baseEnv,
    db,
    get,
    postForm,
    resetDb,
    runInteractive,
    runToCompletion,
    startMongo,
    startService,
    stopMongo,
    tempDir,
    waitFor
};
