import React, { useState } from 'react';
import { Globe } from 'lucide-react';

interface OrbitalBrandMarkProps {
  size?: number;
  className?: string;
  showRing?: boolean;
}

export const LOGO_ASSET_PATH = './assets/aistudio/Picsart_26-11-04_21-40-17-985_7c4ea56f.jpg';

export const OrbitalBrandMark: React.FC<OrbitalBrandMarkProps> = ({
  size = 32,
  className = '',
  showRing = true,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${
        showRing
          ? 'bg-[#000000] ring-1 ring-[#8F6BFF]/45 shadow-[0_0_20px_rgba(143,107,255,0.22)]'
          : 'bg-transparent'
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {!imgFailed ? (
        <img
          src={LOGO_ASSET_PATH}
          alt="SalviaBrowxer"
          width={size}
          height={size}
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`h-full w-full select-none object-cover ${
            showRing ? '' : 'mix-blend-screen'
          }`}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#18122E] to-[#070510] text-[#D9AE54]">
          <Globe className="h-1/2 w-1/2" />
        </span>
      )}
    </span>
  );
};
