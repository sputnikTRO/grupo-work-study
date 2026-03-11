import { google } from 'googleapis';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Google Sheets Client
 *
 * Connects to Google Sheets API using service account credentials
 * and provides methods to read sheet data
 */

// Initialize Google Sheets API client
let sheetsClient = null;

/**
 * Initializes the Google Sheets client with service account credentials
 *
 * @returns {Object} Sheets API client
 */
function getClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });

    logger.info('Google Sheets client initialized');

    return sheetsClient;

  } catch (error) {
    logger.error({ err: error }, 'Error initializing Google Sheets client');
    throw error;
  }
}

/**
 * Reads a complete sheet and parses it into an array of objects
 * First row is treated as headers, remaining rows are data
 *
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {string} sheetName - Sheet name (e.g., 'Colegios', 'Viajes')
 * @returns {Promise<Array>} Array of objects where keys are column headers
 */
export async function readSheet(spreadsheetId, sheetName) {
  const sheetsLogger = logger.child({ spreadsheetId, sheetName, function: 'sheets.readSheet' });

  try {
    const client = getClient();

    sheetsLogger.debug('Reading sheet from Google Sheets API');

    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`, // Read all columns from A to Z
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      sheetsLogger.warn('Sheet is empty');
      return [];
    }

    // First row = headers
    const headers = rows[0];

    // Remaining rows = data
    const dataRows = rows.slice(1);

    // Convert to array of objects
    const data = dataRows
      .filter(row => row.length > 0) // Skip empty rows
      .map(row => {
        const obj = {};

        headers.forEach((header, index) => {
          // Normalize header: lowercase, replace spaces with underscores
          const key = header.toString().toLowerCase().trim().replace(/\s+/g, '_');

          // Get cell value (or null if column doesn't exist in this row)
          obj[key] = row[index] !== undefined ? row[index].toString().trim() : null;
        });

        return obj;
      });

    sheetsLogger.info({ rowCount: data.length, headerCount: headers.length }, 'Sheet read successfully');

    return data;

  } catch (error) {
    sheetsLogger.error({ err: error }, 'Error reading sheet from Google Sheets');

    // Check for specific error types
    if (error.code === 403) {
      sheetsLogger.error('Permission denied. Check service account has access to the spreadsheet');
    } else if (error.code === 404) {
      sheetsLogger.error('Spreadsheet or sheet not found. Check spreadsheet ID and sheet name');
    }

    throw error;
  }
}

/**
 * Reads multiple sheets from the same spreadsheet
 *
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {Array<string>} sheetNames - Array of sheet names to read
 * @returns {Promise<Object>} Object with sheet names as keys and data arrays as values
 */
export async function readMultipleSheets(spreadsheetId, sheetNames) {
  const sheetsLogger = logger.child({ spreadsheetId, sheetCount: sheetNames.length });

  sheetsLogger.info('Reading multiple sheets');

  const results = {};

  for (const sheetName of sheetNames) {
    try {
      results[sheetName] = await readSheet(spreadsheetId, sheetName);
    } catch (error) {
      sheetsLogger.error({ err: error, sheetName }, 'Error reading sheet, continuing with others');
      results[sheetName] = []; // Empty array for failed sheets
    }
  }

  sheetsLogger.info({ successCount: Object.keys(results).length }, 'Finished reading multiple sheets');

  return results;
}

/**
 * Gets spreadsheet metadata (sheet names, etc.)
 *
 * @param {string} spreadsheetId - Google Sheets ID
 * @returns {Promise<Object>} Spreadsheet metadata
 */
export async function getSpreadsheetMetadata(spreadsheetId) {
  const sheetsLogger = logger.child({ spreadsheetId, function: 'sheets.getMetadata' });

  try {
    const client = getClient();

    const response = await client.spreadsheets.get({
      spreadsheetId,
    });

    const metadata = {
      title: response.data.properties.title,
      locale: response.data.properties.locale,
      timeZone: response.data.properties.timeZone,
      sheets: response.data.sheets.map(sheet => ({
        title: sheet.properties.title,
        sheetId: sheet.properties.sheetId,
        index: sheet.properties.index,
        rowCount: sheet.properties.gridProperties.rowCount,
        columnCount: sheet.properties.gridProperties.columnCount,
      })),
    };

    sheetsLogger.info({ sheetCount: metadata.sheets.length }, 'Metadata retrieved');

    return metadata;

  } catch (error) {
    sheetsLogger.error({ err: error }, 'Error getting spreadsheet metadata');
    throw error;
  }
}
