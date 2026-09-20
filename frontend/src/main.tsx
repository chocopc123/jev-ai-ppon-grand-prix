import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DevTool, { isLocalEnvironment } from './DevTool.tsx'

// 過去のプロジェクトや古いPWAのService Workerが残骸として残っている場合は自動解除
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().catch(() => {});
    }
  }).catch(() => {});
}

function Root() {
  const [currentPath, setCurrentPath] = useState(
    () => window.location.pathname + window.location.hash + window.location.search
  );

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname + window.location.hash + window.location.search);
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  const isLocal = isLocalEnvironment();
  const isDevToolRequested =
    currentPath.startsWith('/devtool') ||
    currentPath.includes('#devtool') ||
    currentPath.includes('devtool');

  // ローカル環境かつDevTool要求時のみ表示
  if (isLocal && isDevToolRequested) {
    return <DevTool />;
  }

  return <App />;
}

const container = document.getElementById('root')!;
const globalWithRoot = window as unknown as { _reactRoot?: ReturnType<typeof createRoot> };
const root = globalWithRoot._reactRoot ?? createRoot(container);
globalWithRoot._reactRoot = root;

root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
)


