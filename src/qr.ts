// Decode QR codes from images using the native BarcodeDetector API.

interface DetectedCode {
  rawValue: string;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): {
    detect(source: CanvasImageSource): Promise<DetectedCode[]>;
  };
  getSupportedFormats(): Promise<string[]>;
}

interface BarcodeDetectorWindow {
  BarcodeDetector?: BarcodeDetectorConstructor;
}

function getBarcodeDetector(): BarcodeDetectorConstructor {
  const w = window as unknown as BarcodeDetectorWindow;
  const Ctor = w.BarcodeDetector;
  if (!Ctor) {
    throw new Error("BarcodeDetector is not supported in this Chrome version. Update Chrome.");
  }
  return Ctor;
}

/** Decode all QR codes found in an image file. Throws if none found. */
export async function decodeImageQrs(file: Blob): Promise<string[]> {
  const Ctor = getBarcodeDetector();
  const detector = new Ctor({ formats: ["qr_code"] });
  const bitmap = await createImageBitmap(file);
  try {
    const codes = await detector.detect(bitmap);
    if (!codes.length) throw new Error("No QR code found in image");
    return codes.map((c) => c.rawValue);
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}
