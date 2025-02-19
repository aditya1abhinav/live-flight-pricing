const express = require('express');
const path = require('path');
const routes = require('./routes'); // Import the routes

const app = express();
const port = 3000;

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));

// Use the routes
app.use('/', routes);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
