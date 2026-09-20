import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DevTool, { isLocalEnvironment } from './DevTool.tsx'

function Root() {
  const [currentPath, setCurrentPath] = useState(
    window.location.pathname + window.location.hash + window.location.search
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
    window.location.pathname.startsWith('/devtool') ||
    window.location.hash.startsWith('#devtool') ||
    new URLSearchParams(window.location.search).has('devtool');

  // ローカル環境かつDevTool要求時のみ表示
  if (isLocal && isDevToolRequested) {
    return <DevTool />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

