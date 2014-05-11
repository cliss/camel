init:
	npm install
check: init
	./node_modules/.bin/jshint package.json nodemon.json camel.js
