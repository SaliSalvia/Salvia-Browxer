/**
 * @license
 * SPDX-License-Identifier: GPL-3.0-only
 */

import React, { useEffect, useState } from 'react';
import { AppSplashOverlay } from './components/AppSplashOverlay';
import { MediaQualitySelectionSheet } from './components/MediaQualitySelectionSheet';
import { MediaTraySheet } from './components/MediaTraySheet';
import { TabSwitcher } from './components/TabSwitcher';
import { getSalviaNative } from './core/nativeBridge';
import { BookmarksScreen } from './screens/BookmarksScreen';
import { BrowserScreen } from './screens/BrowserScreen';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { MediaPlayerScreen } from './screens/MediaPlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppProvider, useApp } from './store/AppContext';

const SalviaShell: React.FC = () => {
  const { route, toastMessage } = useApp();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (route !== 'browser') {
      getSalviaNative()?.setBrowserViewport?.(false, 0, 0, 0, 0);
    }
  }, [route]);

  const renderScreen = () => {
    switch (route) {
      case 'browser':
        return <BrowserScreen />;
      case 'downloads':
        return <DownloadsScreen />;
      case 'bookmarks':
        return <BookmarksScreen />;
      case 'history':
        return <HistoryScreen />;
      case 'settings':
        return <SettingsScreen />;
      case 'player':
        return <MediaPlayerScreen />;
      case 'home':
      default:
        return <HomeScreen />;
    }
  };

  return (
    <>
      {renderScreen()}
      <TabSwitcher />
      <MediaTraySheet />
      <MediaQualitySelectionSheet />
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-[#8F6BFF]/70 bg-[#18122E]/95 px-4 py-2.5 text-[13px] font-medium text-[#F4F2FF] shadow-2xl backdrop-blur-md"
        >
          {toastMessage}
        </div>
      ) : null}
      {!splashDone ? <AppSplashOverlay onFinished={() => setSplashDone(true)} /> : null}
    </>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <SalviaShell />
    </AppProvider>
  );
};

export default App;
