const express = require('express');
const router = express.Router();
const csv = require('csvtojson');
const axios = require('axios');
const path = require('path'); // For absolute file paths
require('dotenv').config();

const DUFFEL_ACCESS_TOKEN = process.env.DUFFEL_ACCESS_TOKEN;

// BA Fare Class Mappings:
const BARevenueMapping = {
  "F": "First Class Revenue",
  "A": "First Class Revenue",
  "J": "Business Class Revenue",
  "C": "Business Class Revenue",
  "D": "Business Class Revenue",
  "R": "Business Class Revenue",
  "W": "Premium Economy Revenue",
  "E": "Premium Economy Revenue",
  "T": "Premium Economy Revenue",
  "Y": "Economy Revenue",
  "B": "Economy Revenue",
  "H": "Economy Revenue",
  "K": "Economy Revenue",
  "M": "Economy Revenue",
  "L": "Economy Revenue",
  "V": "Economy Revenue",
  "S": "Economy Revenue",
  "N": "Economy Revenue",
  "Q": "Economy Revenue",
  "O": "Economy Revenue"
};

const BAAwardMapping = {
  "U": "Economy Award",
  "X": "Premium Economy Award",
  "P": "Business Award",
  "Z": "First Class Award"
};

// Airline code to full name mapping
const airlineCodeMapping = {
  "BA": "British Airways",
  "AA": "American Airlines",
  "DL": "Delta Air Lines",
  "UA": "United Airlines",
  "LH": "Lufthansa",
  "AF": "Air France",
  "EK": "Emirates",
  "QR": "Qatar Airways",
  "SQ": "Singapore Airlines",
  "CX": "Cathay Pacific",
  // Add more mappings as needed
};

// Function to get flight offers from Duffel API including flight class
async function getFlightOffers(origin, destination, travelDate, flightClass, limit=100) {
  try {
    const params = {
      data: {
        slices: [
          {
            origin,
            destination,
            departure_date: travelDate,
          },
        ],
        passengers: [
          {
            type: 'adult',
          },
        ],
        cabin_class: flightClass.toLowerCase(), // API expects values like economy, premium_economy, business, first
      }
    };

    console.log("Duffel API Request Parameters:", params);

    const response = await axios.post(
      'https://api.duffel.com/air/offer_requests',
      params,
      {
        headers: {
          Authorization: `Bearer ${DUFFEL_ACCESS_TOKEN}`,
          'Duffel-Version': 'v1',
          'Content-Type': 'application/json',
        },
      }
    );

    const offerRequestId = response.data.data.id;

    // Fetch the offers using the offer request ID
    const offersResponse = await axios.get(
      `https://api.duffel.com/air/offers?offer_request_id=${offerRequestId}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${DUFFEL_ACCESS_TOKEN}`,
          'Duffel-Version': 'v1',
        },
      }
    );

    console.log("Duffel API Offers Response:", offersResponse.data);
    return offersResponse.data;
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
function formatFlightClass(flightClass) {
  flightClass = flightClass.trim();
  if (flightClass.toUpperCase() === 'FIRST CLASS') {
    return 'FIRST';
  }
  return flightClass.replace(/\s+/g, '_').toUpperCase();
}

// Helper function to convert an ISO datetime string to IST (HH:MM)
function convertToIST(timeStr) {
  const date = new Date(timeStr);
  return date.toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
}

// Helper function to format a time difference (ms) to hours and minutes.
function formatLayover(diffMs) {
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Route to render the homepage from CSV data
router.get('/', async (req, res) => {
  try {
    const csvFilePath = path.join(__dirname, '../data/flights.csv');
    console.log("CSV File Path:", csvFilePath);
    const flightData = await csv().fromFile(csvFilePath);
    res.render('index', { flightData: flightData });
  } catch (error) {
    console.error('Error reading CSV:', error);
    res.status(500).send('Error reading CSV data.');
  }
});

// Flight details route including flight class as a URL parameter
router.get('/flight/:origin/:destination/:travelDate/:flightClass', async (req, res) => {
  const { origin, destination, travelDate, flightClass } = req.params;
  const formattedFlightClass = formatFlightClass(flightClass);
  const airlineFilter = req.query.airline ? req.query.airline.trim().toLowerCase() : '';

  try {
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
      formattedFlightClass
    );

    // Process each offer as before (converting prices, extracting names, timings, layovers, etc.)
    const flightDetails = await Promise.all(
      flightOffers.data.map(async (offer) => {
        const priceEUR = offer.total_amount ? parseFloat(offer.total_amount) : 0;
        const priceINR = await convertEURtoINR(priceEUR);
        let aircraftName = 'Unknown';
        let airlineName = 'Unknown';
        let layovers = [];
        let timings = [];
        let stops = 0;
        let fareDescription = 'N/A';
        let fareBasisCode = 'N/A';
        let numberOfSeatsAvailable = 'N/A';

        if (
          offer.slices &&
          offer.slices[0] &&
          offer.slices[0].segments &&
          offer.slices[0].segments.length > 0
        ) {
          const segments = offer.slices[0].segments;
          stops = segments.length - 1;

          // Extract aircraft and airline names from the first segment
          const aircraftCode = segments[0].aircraft?.code;
          aircraftName = segments[0].aircraft?.name || 'Unknown';
          const carrierCode = segments[0].operating_carrier?.iata_code;
          airlineName = segments[0].operating_carrier?.name || 'Unknown';

          // Add IST timings and map fare description for each segment.
          segments.forEach(segment => {
            segment.departureIST = convertToIST(segment.departing_at);
            segment.arrivalIST = convertToIST(segment.arriving_at);
            timings.push(`${segment.departureIST} to ${segment.arrivalIST}`);

            // Check for booking class codes and map to BA's fare structure
            const bookingCode = segment.cabin_class_marketing_name || segment.cabin_class;
            if (carrierCode === 'BA' && bookingCode) {
              if (BARevenueMapping[bookingCode]) {
                fareDescription = `${BARevenueMapping[bookingCode]} - "${bookingCode}"`;
              } else if (BAAwardMapping[bookingCode]) {
                fareDescription = `${BAAwardMapping[bookingCode]} - "${bookingCode}"`;
              } else {
                fareDescription = bookingCode;
              }
            }

            // Extract fare basis code and number of seats available
            if (segment.passengers && segment.passengers.length > 0) {
              fareBasisCode = segment.passengers[0].fare_basis_code || 'N/A';
              numberOfSeatsAvailable = segment.passengers[0].cabin.amenities.seat.pitch || 'N/A';
            }
          });

          // Calculate layover durations if there are connecting segments.
          if (segments.length > 1) {
            for (let i = 0; i < segments.length - 1; i++) {
              const arrival = new Date(segments[i].arriving_at);
              const nextDeparture = new Date(segments[i + 1].departing_at);
              const diffMs = nextDeparture - arrival;
              layovers.push(formatLayover(diffMs));
            }
          }
        }

        return {
          ...offer,
          id: offer.id, // Include the flight id
          priceINR: priceINR.toFixed(2),
          aircraftName,
          airlineName,
          stops,
          timings,
          layovers,
          fareBasisCode,
          numberOfSeatsAvailable
        };
      })
    );

    // If an airline filter was provided, filter the flight offers based on airlineName or airline code.
    let filteredFlightDetails = flightDetails;
    if (airlineFilter) {
      const airlineFullName = airlineCodeMapping[airlineFilter.toUpperCase()] || airlineFilter;
      filteredFlightDetails = flightDetails.filter(offer =>
        offer.airlineName.toLowerCase().includes(airlineFullName.toLowerCase())
      );
    }

    res.render('flightDetails', {
      origin,
      destination,
      travelDate,
      flightOffers: filteredFlightDetails || [],
    });
  } catch (error) {
    console.error('Error fetching flight details:', error.response ? error.response.data : error.message);
    res.status(500).send('Error fetching flight details.');
  }
});

module.exports = router;
