const express = require('express');
const router = express.Router();
const csv = require('csvtojson');
const axios = require('axios');
const path = require('path'); // Use path for absolute paths
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
// Converts "PREMIUM ECONOMY" to "PREMIUM_ECONOMY"
// and maps "FIRST CLASS" to "FIRST".
function formatFlightClass(flightClass) {
  flightClass = flightClass.trim();
  if (flightClass.toUpperCase() === 'FIRST CLASS') {
    return 'FIRST';
  }
  return flightClass.replace(/\s+/g, '_').toUpperCase();
}

// Helper function to convert a given ISO datetime string to IST (formatted as HH:MM)
function convertToIST(timeStr) {
  const date = new Date(timeStr);
  return date.toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
}

// Helper function to format a time difference (in milliseconds) to hours and minutes.
function formatLayover(diffMs) {
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Route to render the homepage from CSV data
router.get('/', async (req, res) => {
  try {
    // Build the absolute path to your CSV file.
    const csvFilePath = path.join(__dirname, '../data/flights.csv');
    const flightData = await csv().fromFile(csvFilePath);
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
  // Format the flight class (e.g., "PREMIUM ECONOMY" becomes "PREMIUM_ECONOMY", "FIRST CLASS" becomes "FIRST")
  const formattedFlightClass = formatFlightClass(flightClass);

  try {
    const accessToken = await getAmadeusToken();
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

    // Process each offer: convert price, extract aircraft/airline names, add IST timings, and calculate layover durations.
    const flightDetails = await Promise.all(
      flightOffers.data.map(async (offer) => {
        const priceEUR = offer.price && offer.price.total ? parseFloat(offer.price.total) : 0;
        const priceINR = await convertEURtoINR(priceEUR);
        let aircraftName = 'Unknown';
        let airlineName = 'Unknown';
        let layovers = []; // Array to store layover durations

        if (
          offer.itineraries &&
          offer.itineraries[0] &&
          offer.itineraries[0].segments &&
          offer.itineraries[0].segments.length > 0
        ) {
          const segments = offer.itineraries[0].segments;
          // Extract aircraft and airline names from the first segment
          const aircraftCode = segments[0].aircraft.code;
          aircraftName = flightOffers.dictionaries.aircraft[aircraftCode] || 'Unknown';
          const carrierCode = segments[0].carrierCode;
          airlineName = flightOffers.dictionaries.carriers[carrierCode] || 'Unknown';

          // Add departure and arrival IST timings for each segment.
          segments.forEach(segment => {
            segment.departureIST = convertToIST(segment.departure.at);
            segment.arrivalIST = convertToIST(segment.arrival.at);
          });

          // Calculate layover durations if there are connecting segments.
          if (segments.length > 1) {
            for (let i = 0; i < segments.length - 1; i++) {
              const arrival = new Date(segments[i].arrival.at);
              const nextDeparture = new Date(segments[i + 1].departure.at);
              const diffMs = nextDeparture - arrival;
              layovers.push(formatLayover(diffMs));
            }
          }
        }

        return {
          ...offer,
          priceINR: priceINR.toFixed(2),
          aircraftName,
          airlineName,
          layovers
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
