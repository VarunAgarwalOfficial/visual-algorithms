.PHONY: check lint

check:
	npm ci
	npm test
	npm run build

lint:
	npm run lint
