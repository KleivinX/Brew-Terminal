import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { AppearancePanel } from './AppearancePanel';
import { MarketsPanel } from './MarketsPanel';
import { ProvidersPanel } from './ProvidersPanel';
import { AiPanel } from './AiPanel';
import { ProfilePanel } from './ProfilePanel';
import { PrivacyPanel } from './PrivacyPanel';
import { AboutPanel } from './AboutPanel';
import styles from './SettingsRoute.module.css';

const SECTIONS = [
  { to: '/settings/appearance', label: 'Appearance' },
  { to: '/settings/markets', label: 'Markets' },
  { to: '/settings/providers', label: 'Data providers' },
  { to: '/settings/ai', label: 'AI providers' },
  { to: '/settings/privacy', label: 'Privacy and data' },
  { to: '/settings/profile', label: 'Backup and transfer' },
  { to: '/settings/about', label: 'About' },
];

export function SettingsRoute() {
  return (
    <>
      <WorkspaceHeader title="Settings" subtitle="Providers, privacy, appearance" />

      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Settings sections">
          <ul role="list" className={styles.navList}>
            {SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink
                  to={section.to}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.navActive : null].filter(Boolean).join(' ')
                  }
                >
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.content}>
          <Routes>
            <Route index element={<Navigate to="/settings/appearance" replace />} />
            <Route path="appearance" element={<AppearancePanel />} />
            <Route path="markets" element={<MarketsPanel />} />
            <Route path="providers" element={<ProvidersPanel />} />
            <Route path="ai" element={<AiPanel />} />
            <Route path="privacy" element={<PrivacyPanel />} />
            <Route path="profile" element={<ProfilePanel />} />
            <Route path="about" element={<AboutPanel />} />
          </Routes>
        </div>
      </div>
    </>
  );
}
