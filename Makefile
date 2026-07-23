# Grocery Management System — repository tasks
#
# The system is two independent Node services rather than one package, so there
# is no root package.json to hang npm scripts off. This Makefile is the single
# entry point that knows where each service lives.
#
#   src/groceryfrontend/   Express app and UI (port 4000)
#   src/newserver/         edge capture and database services
#   scripts/               repository tooling

FRONTEND := src/groceryfrontend
EDGE     := src/newserver
TESTS    := tests

.PHONY: demo demo-down install start simulate seed check test clean

# The whole system, self-contained: local database, seeded pantry, UI on port 4000.
# Needs Docker only. No Atlas account, no Arduino, no configuration.
demo:
	docker compose up --build

demo-down:
	docker compose down -v

# Install dependencies for both services.
install:
	cd $(FRONTEND) && npm install
	cd $(EDGE) && npm install

# Serve the UI on http://localhost:4000. Needs $(FRONTEND)/.env.
start:
	cd $(FRONTEND) && npm start

# Feed the system product codes without any hardware attached.
simulate:
	cd $(EDGE) && npm run simulate

# Put a small pantry and some sample scans into an empty database.
seed:
	cd $(EDGE) && npm run seed

# Refuse to ship if anything resembling a real credential is in the tree. This
# system holds database, cloud and TLS secrets, so the repo has to check itself.
check:
	@./scripts/check-secrets.sh

# Automated tests. They start the real services as real processes and drive them
# from the outside, so nothing under src/ had to be reshaped to make it testable.
# The database is supplied by the tests themselves — no Docker, no Atlas account.
#
# Kept separate from `check`: that one needs nothing installed and runs in a
# second, which is what makes it usable as a habit before every push.
test: install
	cd $(TESTS) && npm install --no-audit --no-fund && npm test

clean:
	rm -rf $(FRONTEND)/node_modules $(EDGE)/node_modules $(TESTS)/node_modules
