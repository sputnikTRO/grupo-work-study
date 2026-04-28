import { google } from 'googleapis';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Google Drive Client
 *
 * Downloads files from Google Drive using service account credentials
 * Same credentials used for Google Sheets
 */

let driveClient = null;

/**
 * Initializes the Google Drive client with service account credentials
 *
 * @returns {Object} Drive API client
 */
function getClient() {
  if (driveClient) {
    return driveClient;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });

    driveClient = google.drive({ version: 'v3', auth });

    logger.info('Google Drive client initialized');

    return driveClient;

  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Google Drive client');
    throw new Error('Google Drive client initialization failed');
  }
}

/**
 * Extracts Google Drive file ID from various URL formats
 *
 * @param {string} url - Google Drive URL
 * @returns {string|null} - File ID or null if not a Drive URL
 */
export function extractFileId(url) {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,           // /file/d/ID
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,           // /open?id=ID
    /drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/,             // /uc?id=ID
    /drive\.google\.com\/u\/\d+\/uc\?id=([a-zA-Z0-9_-]+)/,     // /u/0/uc?id=ID
    /id=([a-zA-Z0-9_-]+)/,                                      // any ?id=ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Downloads a file from Google Drive using Drive API
 *
 * @param {string} fileId - Google Drive file ID
 * @returns {Promise<Buffer>} - File content as buffer
 */
export async function downloadFile(fileId) {
  try {
    logger.info({ fileId }, 'Downloading file from Google Drive using API');

    const drive = getClient();

    // Get file metadata first to check size
    const metadata = await drive.files.get({
      fileId,
      fields: 'name, size, mimeType',
    });

    logger.info({
      fileId,
      name: metadata.data.name,
      size: metadata.data.size,
      mimeType: metadata.data.mimeType,
    }, 'File metadata retrieved');

    // Download file content
    const response = await drive.files.get({
      fileId,
      alt: 'media',
    }, {
      responseType: 'arraybuffer',
    });

    const buffer = Buffer.from(response.data);

    logger.info({
      fileId,
      name: metadata.data.name,
      downloadedSize: buffer.length,
    }, 'File downloaded successfully from Google Drive');

    return buffer;

  } catch (error) {
    logger.error({
      err: error,
      fileId,
      errorCode: error.code,
      errorMessage: error.message,
    }, 'Error downloading file from Google Drive');

    if (error.code === 404) {
      throw new Error(`File not found in Google Drive (ID: ${fileId}). Make sure the file is shared with the service account: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    }

    if (error.code === 403) {
      throw new Error(`Permission denied. Share the file with the service account: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    }

    throw new Error(`Google Drive download failed: ${error.message}`);
  }
}

/**
 * Checks if a URL is a Google Drive URL
 *
 * @param {string} url - URL to check
 * @returns {boolean} - True if it's a Google Drive URL
 */
export function isGoogleDriveUrl(url) {
  return url && url.includes('drive.google.com');
}
