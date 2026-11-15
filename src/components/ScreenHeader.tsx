import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../store/AppContext';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
  actions?: React.ReactNode;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, onBack, actions }) => {
  const { isRtl, t } = useApp();

  return (
    <header className="sticky top-0 z-20 border-b border-[#312556]/60 bg-[#070510]/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('go_back')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#F4F2FF] transition-colors hover:bg-[#18122E] md:hidden"
          >
            {isRtl ? <ArrowRight className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
          </button>
          <h1 className="font-display truncate text-[18px] font-bold tracking-tight text-[#F4F2FF]">
            {title}
          </h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </header>
  );
};
