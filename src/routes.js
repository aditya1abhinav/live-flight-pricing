const express = require('express');
const router = express.Router();
const csv = require('csvtojson');
const axios = require('axios');
require('dotenv').config();

const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;

// Function to fetch Amadeus access token
async function getAmadeusToken() {
    try {
        const response = await axios.post(
            'https://test.api.amadeus.com/v1/security/oauth2/token',
            `grant_type=client_credentials&client_id=${AMADEUS_API_KEY}&client_secret=${AMADEUS_API_SECRET}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('Error fetching Amadeus token:', error);
        throw error;
    }
}

// Function to get flight offers from Amadeus API including flight class
async function getFlightOffers(origin, destination, travelDate, accessToken, flightClass) {
    try {
        const params = {
            originLocationCode: origin,
            destinationLocationCode: destination,
            departureDate: travelDate,
            adults: 1, // Assuming 1 adult
            max: 250, // Limiting the number of results
            travelClass: flightClass // API expects values like ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST
        };

        console.log("Amadeus API Request Parameters:", params);

        const response = await axios.get(
            'https://test.api.amadeus.com/v2/shopping/flight-offers',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: params,
            }
        );

        console.log("Amadeus API Response:", response.data);
        return response.data;
    } catch (error) {
        console.error('Error fetching flight offers:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// Function to convert DD-MM-YYYY to YYYY-MM-DD
function formatDate(dateString) {
    const parts = dateString.split('-');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// Function to convert EUR to INR
async function convertEURtoINR(amount) {
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/EUR');
        const exchangeRate = response.data.rates['INR'];
        return amount * exchangeRate;
    } catch (error) {
        console.error('Error converting EUR to INR:', error);
        throw error;
    }
}

// Helper function to format flight class values.
// This converts values like "PREMIUM ECONOMY" to "PREMIUM_ECONOMY"
// and maps "FIRST CLASS" to "FIRST".
function formatFlightClass(flightClass) {
    flightClass = flightClass.trim();
    if (flightClass.toUpperCase() === 'FIRST CLASS') {
        return 'FIRST';
    }
    return flightClass.replace(/\s+/g, '_').toUpperCase();
}

router.get('/', async (req, res) => {
    try {
        // CSV columns are "Origin", "Destination", "Travel Date", and "Class"
        const flightData = await csv().fromFile('./data/flights.csv');
        res.render('index', { flightData: flightData });
    } catch (error) {
        console.error('Error reading CSV:', error);
        res.status(500).send('Error reading CSV data.');
    }
});

// Flight details route including flight class as a URL parameter
// Expected URL format: /flight/Origin/Destination/TravelDate/Class
router.get('/flight/:origin/:destination/:travelDate/:flightClass', async (req, res) => {
    const { origin, destination, travelDate, flightClass } = req.params;
    // Format the flight class (e.g., "PREMIUM ECONOMY" becomes "PREMIUM_ECONOMY" and "FIRST CLASS" becomes "FIRST")
    const formattedFlightClass = formatFlightClass(flightClass);

    try {
        const accessToken = await getAmadeusToken();

        // Format the travel date from DD-MM-YYYY to YYYY-MM-DD
        const formattedTravelDate = formatDate(travelDate);

        console.log(`Fetching flight offers with:
            Origin: ${origin},
            Destination: ${destination},
            Departure Date: ${formattedTravelDate},
            Class: ${formattedFlightClass}`);

        const flightOffers = await getFlightOffers(
            origin,
            destination,
            formattedTravelDate,
            accessToken,
            formattedFlightClass
        );

        // Convert prices to INR and extract aircraft name for each offer
        const flightDetails = await Promise.all(
            flightOffers.data.map(async (offer) => {
                const priceEUR = offer.price && offer.price.total ? parseFloat(offer.price.total) : 0;
                const priceINR = await convertEURtoINR(priceEUR);
                let aircraftName = 'Unknown';

                if (
                    offer.itineraries &&
                    offer.itineraries[0] &&
                    offer.itineraries[0].segments &&
                    offer.itineraries[0].segments[0]
                ) {
                    const aircraftCode = offer.itineraries[0].segments[0].aircraft.code;
                    aircraftName = flightOffers.dictionaries.aircraft[aircraftCode] || 'Unknown';
                }

                return {
                    ...offer,
                    priceINR: priceINR.toFixed(2),
                    aircraftName,
                };
            })
        );

        res.render('flightDetails', {
            origin,
            destination,
            travelDate,
            flightOffers: flightDetails || [],
        });
    } catch (error) {
        console.error('Error fetching flight details:', error.response ? error.response.data : error.message);
        res.status(500).send('Error fetching flight details.');
    }
});

module.exports = router;
