'use client';

import * as React from 'react';
import { CameraOff } from 'lucide-react';

/**
 * Minimal typings for the native BarcodeDetector API (not yet in TS DOM lib).
 * Chrome/Edge on Android + desktop, and recent Safari, implement it; the
 * parent feature-detects before rendering this component.
 */
interface DetectedBarcodeLike {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export function isBarcodeDetectorSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

const PREFERRED_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * Rear-camera scan loop over the native BarcodeDetector. Fires `onDetect` for
 * every read; the parent applies the duplicate-scan guard and feedback.
 */
export function CameraScanner({
  active,
  onDetect,
}: {
  active: boolean;
  onDetect: (code: string) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const onDetectRef = React.useRef(onDetect);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    onDetectRef.current = onDetect;
  });

  React.useEffect(() => {
    if (!active) return;
    if (!isBarcodeDetectorSupported()) {
      setError('Camera scanning is not supported by this browser.');
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setError(null);

    const DetectorCtor = (window as unknown as { BarcodeDetector: BarcodeDetectorConstructor })
      .BarcodeDetector;

    const start = async () => {
      let detector: BarcodeDetectorLike;
      try {
        let formats: string[] | undefined;
        if (DetectorCtor.getSupportedFormats) {
          const supported = await DetectorCtor.getSupportedFormats();
          formats = PREFERRED_FORMATS.filter((format) => supported.includes(format));
          if (formats.length === 0) formats = undefined;
        }
        detector = new DetectorCtor(formats ? { formats } : undefined);
      } catch {
        if (!cancelled) setError('Could not initialize the barcode detector on this device.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch {
        if (!cancelled) {
          setError('Camera access was denied. Allow camera permission or use manual entry.');
        }
        return;
      }

      if (cancelled || !videoRef.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay refusals surface as a frozen preview; the loop still tries.
      }

      const scanOnce = async () => {
        if (cancelled || !videoRef.current) return;
        const target = videoRef.current;
        if (target.readyState >= 2) {
          try {
            const results = await detector.detect(target);
            for (const result of results) {
              if (result.rawValue) onDetectRef.current(result.rawValue);
            }
          } catch {
            // Individual frames can fail (e.g. zero-size frame); keep looping.
          }
        }
        if (!cancelled) timer = setTimeout(() => void scanOnce(), 250);
      };
      void scanOnce();
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active]);

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center"
      >
        <CameraOff className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label="Camera preview for barcode scanning"
        className="mx-auto max-h-[60vh] w-full object-contain"
      />
      {/* Aiming frame */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-40 w-64 max-w-[80%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>
    </div>
  );
}
