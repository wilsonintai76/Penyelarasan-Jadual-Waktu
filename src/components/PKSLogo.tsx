import React, { useState, useEffect } from 'react';

interface PKSLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Replaces the preset size box entirely, e.g. an exact mm footprint for print documents. */
  boxClassName?: string;
  customLogo?: string; // Supports Cloudflare R2 URL (/api/logo?v=...), base64 data URL, or direct image URL
}

export const PKSLogo: React.FC<PKSLogoProps> = ({
  className = '',
  size = 'md',
  boxClassName,
  customLogo
}) => {
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    setErrorCount(0);
  }, [customLogo]);

  const localSvgUrl = '/assets/logo_pks.svg';
  const driveFileId = '1FoNwSZQwqu0XYdznM8T0YRFqW9VghMsS';
  const directLogoUrl = `https://lh3.googleusercontent.com/d/${driveFileId}`;

  const dimMap = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-18 h-18',
    xl: 'w-24 h-24'
  };

  const selectedDim = boxClassName || dimMap[size] || dimMap.md;

  // Determine active source:
  // If customLogo is specified and has not errored, use it first!
  let currentSrc = localSvgUrl;
  if (customLogo && customLogo.trim().length > 0 && errorCount === 0) {
    currentSrc = customLogo.trim();
  } else if (errorCount === 1) {
    currentSrc = localSvgUrl;
  } else if (errorCount === 2) {
    currentSrc = directLogoUrl;
  }

  // Fallback tertiary inline SVG if all sources fail
  if (errorCount >= 3) {
    return (
      <div className={`flex items-center justify-center ${selectedDim} ${className}`}>
        <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <rect x="6" y="6" width="88" height="88" rx="14" fill="#002b66" stroke="#facc15" strokeWidth="3" />
          <polygon points="50,16 82,34 82,66 50,84 18,66 18,34" fill="none" stroke="#facc15" strokeWidth="4" />
          <text x="50" y="52" textAnchor="middle" fill="#ffffff" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="18">PKS</text>
          <text x="50" y="68" textAnchor="middle" fill="#93c5fd" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="9">JKM</text>
        </svg>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${selectedDim} ${className} print:opacity-100`}>
      <img
        src={currentSrc}
        alt="Logo Rasmi Politeknik Kuching Sarawak"
        className="max-h-full max-w-full object-contain mx-auto print:max-h-full"
        style={{
          printColorAdjust: 'exact',
          WebkitPrintColorAdjust: 'exact'
        }}
        referrerPolicy="no-referrer"
        crossOrigin={currentSrc.startsWith('data:') ? undefined : 'anonymous'}
        onError={() => setErrorCount(prev => prev + 1)}
      />
    </div>
  );
};
