import { useEffect, useState } from 'react';
import UserView from './UserView';
import ReviewerView from './ReviewerView';
import { SAGE, SAGE_LIGHT } from './components';

type Tab = 'user' | 'reviewer';

function readTabFromHash(): Tab {
  return window.location.hash === '#reviewer' ? 'reviewer' : 'user';
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'user', label: '사용자 (인터뷰)', icon: '👤' },
    { id: 'reviewer', label: '검사자 (검토)', icon: '🔍' },
  ];

  return (
    <header style={{
      padding: '10px 24px 0', display: 'flex', alignItems: 'flex-end',
      justifyContent: 'space-between', borderBottom: '1px solid var(--border-light)',
      background: 'var(--bg-card)', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 10 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
          color: 'var(--accent)', letterSpacing: '-0.02em',
        }}>Dabom</h1>
        <span style={{
          fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '0.04em',
          textTransform: 'uppercase' as const,
        }}>Social Isolation Assessment</span>
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              style={{
                padding: '9px 18px',
                borderRadius: '10px 10px 0 0',
                border: '1px solid var(--border-light)',
                borderBottom: active ? `2px solid ${SAGE}` : '1px solid var(--border-light)',
                background: active ? SAGE_LIGHT : 'transparent',
                color: active ? SAGE : 'var(--text-secondary)',
                fontSize: 13, fontWeight: active ? 600 : 500,
                cursor: 'pointer', fontFamily: 'var(--font-body)',
                marginBottom: -1,
              }}
            >
              <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTabFromHash);

  useEffect(() => {
    const onHashChange = () => setTab(readTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleTabChange = (t: Tab) => {
    window.location.hash = t === 'reviewer' ? '#reviewer' : '#user';
    setTab(t);
  };

  return (
    <>
      <TabBar tab={tab} onChange={handleTabChange} />
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{
          flex: 1, overflow: 'hidden',
          display: tab === 'user' ? 'flex' : 'none',
          flexDirection: 'column',
        }}>
          <UserView />
        </div>
        <div style={{
          flex: 1, overflow: 'hidden',
          display: tab === 'reviewer' ? 'flex' : 'none',
          flexDirection: 'column',
        }}>
          <ReviewerView active={tab === 'reviewer'} />
        </div>
      </main>
    </>
  );
}
