import QRCode from 'qrcode';

/**
 * Generate a QR code as a PNG buffer from the given data string.
 */
export async function generateQrPng(data: string): Promise<Buffer> {
  return QRCode.toBuffer(data, {
    type: 'png',
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

/**
 * Generate a QR code as a data URL string.
 */
export async function generateQrDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}
