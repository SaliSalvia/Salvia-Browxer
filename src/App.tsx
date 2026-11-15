/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { TopBar, type WorkspaceTab } from './components/TopBar';
import { MediaEngineWorkspace } from './components/MediaEngineWorkspace';
import { EngineAuditPanel } from './components/EngineAuditPanel';
import { TermuxCiWorkspace } from './components/TermuxCiWorkspace';
import { RepoExplorerWorkspace } from './components/RepoExplorerWorkspace';

function getInitialTab(): WorkspaceTab {
  if (typeof window === 'undefined') return 'engine';
  const param = new URLSearchParams(window.location.search).get('tab');
  if (param === 'audit' || param === 'termux-ci' || param === 'repo' || param === 'engine') {
    return param;
  }
  return 'engine';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(getInitialTab);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string>('.github/workflows/release.yml');
  const [appId, setAppId] = useState<string>('com.mediagrab.downloader');
  const [appName, setAppName] = useState<string>('MediaGrab Pro');

  const zipUrl = useMemo(() => {
    const params = new URLSearchParams({
      appId: appId.trim() || 'com.mediagrab.downloader',
      appName: appName.trim() || 'MediaGrab Pro',
    });
    return `/api/repo-bundle.zip?${params.toString()}`;
  }, [appId, appName]);

  function handleOpenRepoFile(filePath: string) {
    setSelectedRepoPath(filePath);
    setActiveTab('repo');
  }

  return (
    <div id="top" className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar activeTab={activeTab} onSelectTab={setActiveTab} zipUrl={zipUrl} />

      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-8 sm:px-6">
        {activeTab === 'engine' && <MediaEngineWorkspace />}
        {activeTab === 'audit' && <EngineAuditPanel onOpenRepoFile={handleOpenRepoFile} />}
        {activeTab === 'termux-ci' && <TermuxCiWorkspace />}
        {activeTab === 'repo' && (
          <RepoExplorerWorkspace
            selectedPath={selectedRepoPath}
            onSelectPath={setSelectedRepoPath}
            appId={appId}
            appName={appName}
            onChangeAppId={setAppId}
            onChangeAppName={setAppName}
            zipUrl={zipUrl}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-4 text-xs text-slate-500 sm:px-6">
          <span>MediaForge CI · موتور تشخیص الگومحور مدیا و وورکفلوی ریلیز اندروید</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('termux-ci')}
              className="hover:text-slate-800 cursor-pointer"
            >
              تنظیم ۴ سکرت ترموکس
            </button>
            <span aria-hidden="true">·</span>
            <a
              href={zipUrl}
              download="mediagrab-android-release-repo.zip"
              className="hover:text-slate-800"
            >
              دریافت سورس آماده (.zip)
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
