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

.PHONY: install start simulate check clean

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

# Refuse to ship if anything resembling a real credential is in the tree. This
# system holds database, cloud and TLS secrets, so the repo has to check itself.
check:
	@./scripts/check-secrets.sh

clean:
	rm -rf $(FRONTEND)/node_modules $(EDGE)/node_modules
