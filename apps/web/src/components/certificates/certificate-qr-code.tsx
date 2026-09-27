'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type JSX } from 'react';

/**
 * Renders a QR code encoding ONLY the public verification URL - never a
 * score, email, database id, or any other learner data (there is nothing
 * else available to encode: this component receives just the URL string).
 * Uses the `qrcode` package (the project's first QR dependency - no
 * existing library to reuse) rather than any hand-rolled encoding.
 */
export function CertificateQrCode({
  verificationUrl,
  size = 160,
}: {
  verificationUrl: string;
  size?: number;
}): JSX.Element | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(verificationUrl, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [verificationUrl, size]);

  if (!dataUrl) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a data: URI is not eligible for next/image optimization
    <img
      src={dataUrl}
      alt="QR code linking to this certificate's public verification page"
      width={size}
      height={size}
    />
  );
}
