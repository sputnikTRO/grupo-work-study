import axios from 'axios';
import FormData from 'form-data';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import redis from '../database/redis.js';

/**
 * WhatsApp Media Uploader
 *
 * Uploads media files to WhatsApp Cloud API and caches media IDs
 * This is more reliable than sending external URLs, especially for Google Drive files
 */

const API_BASE_URL = `https://graph.facebook.com/${env.WA_API_VERSION}`;
const MEDIA_CACHE_TTL = 60 * 60 * 24 * 29; // 29 days (WhatsApp media expires after 30 days)

/**
 * Downloads a file from a URL
 *
 * @param {string} url - URL to download from (Google Drive, etc)
 * @returns {Promise<Buffer>} - File content as buffer
 */
async function downloadFile(url) {
  try {
    logger.info({ url }, 'Downloading file from URL');

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout for large files
      maxContentLength: 100 * 1024 * 1024, // 100MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WorkStudyBot/1.0)',
      },
    });

    const buffer = Buffer.from(response.data);
    logger.info({ size: buffer.length }, 'File downloaded successfully');

    return buffer;
  } catch (error) {
    logger.error({ err: error, url }, 'Error downloading file');
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Uploads media to WhatsApp Cloud API
 *
 * @param {Buffer} fileBuffer - File content as buffer
 * @param {string} mimeType - MIME type (e.g., 'application/pdf', 'image/jpeg')
 * @param {string} filename - Original filename
 * @param {string} phoneNumberId - WhatsApp phone number ID
 * @returns {Promise<string>} - WhatsApp media ID
 */
async function uploadToWhatsApp(fileBuffer, mimeType, filename, phoneNumberId) {
  const url = `${API_BASE_URL}/${phoneNumberId}/media`;

  try {
    logger.info({ filename, size: fileBuffer.length, mimeType }, 'Uploading media to WhatsApp');

    // Create multipart form data
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', fileBuffer, {
      filename,
      contentType: mimeType,
    });

    const response = await axios.post(url, formData, {
      headers: {
        'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
        ...formData.getHeaders(),
      },
      maxBodyLength: 100 * 1024 * 1024, // 100MB max
      timeout: 120000, // 2 minute timeout for upload
    });

    const mediaId = response.data.id;
    logger.info({ mediaId, filename }, 'Media uploaded successfully to WhatsApp');

    return mediaId;
  } catch (error) {
    logger.error({
      err: error,
      filename,
      responseData: error.response?.data
    }, 'Error uploading media to WhatsApp');
    throw new Error(`WhatsApp media upload failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Gets cached media ID or uploads file if not cached
 *
 * @param {string} materialId - Material identifier (e.g., 'BROCHURE_LON_CEWIN')
 * @param {string} url - URL to download file from
 * @param {string} mimeType - MIME type
 * @param {string} filename - Filename
 * @param {string} phoneNumberId - WhatsApp phone number ID
 * @returns {Promise<string>} - WhatsApp media ID
 */
export async function getOrUploadMedia(materialId, url, mimeType, filename, phoneNumberId) {
  const cacheKey = `whatsapp:media:${materialId}`;

  try {
    // Check if media ID is cached
    const cachedMediaId = await redis.getClient().get(cacheKey);

    if (cachedMediaId) {
      logger.info({ materialId, mediaId: cachedMediaId }, 'Using cached WhatsApp media ID');
      return cachedMediaId;
    }

    // Not cached - download and upload
    logger.info({ materialId, url }, 'Media not cached, downloading and uploading to WhatsApp');

    // Download file
    const fileBuffer = await downloadFile(url);

    // Upload to WhatsApp
    const mediaId = await uploadToWhatsApp(fileBuffer, mimeType, filename, phoneNumberId);

    // Cache the media ID for 29 days
    await redis.getClient().setex(cacheKey, MEDIA_CACHE_TTL, mediaId);
    logger.info({ materialId, mediaId }, 'Media ID cached for 29 days');

    return mediaId;

  } catch (error) {
    logger.error({ err: error, materialId, url }, 'Error getting or uploading media');
    throw error;
  }
}

/**
 * Determines MIME type from material type and URL
 *
 * @param {string} tipo - Material tipo field
 * @param {string} url - Material URL
 * @returns {string} - MIME type
 */
export function getMimeType(tipo, url) {
  const tipoLower = (tipo || '').toLowerCase();
  const urlLower = (url || '').toLowerCase();

  // Check tipo field first
  if (tipoLower === 'pdf' || tipoLower === 'document') {
    return 'application/pdf';
  }

  if (tipoLower === 'imagen' || tipoLower === 'image') {
    if (urlLower.includes('.png')) return 'image/png';
    if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) return 'image/jpeg';
    if (urlLower.includes('.gif')) return 'image/gif';
    if (urlLower.includes('.webp')) return 'image/webp';
    return 'image/jpeg'; // default for images
  }

  // Fallback to URL extension
  if (urlLower.endsWith('.pdf')) return 'application/pdf';
  if (urlLower.endsWith('.png')) return 'image/png';
  if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) return 'image/jpeg';
  if (urlLower.endsWith('.gif')) return 'image/gif';
  if (urlLower.endsWith('.webp')) return 'image/webp';

  // Default
  return 'application/octet-stream';
}
