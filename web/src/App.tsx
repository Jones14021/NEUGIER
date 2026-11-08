import { useSyncExternalStore } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bot, FlaskConical, Images, ListTodo, Map, Menu, Navigation, Wallet } from 'lucide-react';
import { ROLE_LABEL, sortedDays } from '@neugier/shared';
import { api, subscribeWork, workStatus } from './api';
import { MapProvider } from './components/MapView';
import { ShareDialog } from './components/ShareDialog';
import { findToday, useOnline } from './hooks';
import { Admin } from './pages/Admin';
import { Chat } from './pages/Chat';
import { DayPage } from './pages/DayPage';
import { Expenses } from './pages/Expenses';
import { Memories } from './pages/Memories';
import { More } from './pages/More';
import { Overview } from './pages/Overview';
import { Playground } from './pages/Playground';
import { Todos } from './pages/Todos';
import { useStore } from './store';

export function App({ onLogout }: { onLogout: () => void }) {
  const { state, user, online, trips, canPlan, pendingCount, geocoding } = useStore();
  const netOnline = useOnline();
  const navigate = useNavigate();
  const location = useLocation();
  const work = useSyncExternalStore(subscribeWork, workStatus, workStatus);

  if (!state) {
    return (
      <div className="center">
        <div className="card narrow">
          {trips?.length === 0 ? <p>Noch keine Reise vorhanden.</p> : <p className="muted">Lädt …</p>}
          <button className="btn" onClick={() => api('/auth/logout', { method: 'POST' }).then(onLogout)}>
            Abmelden
          </button>
        </div>
      </div>
    );
  }

  const today = findToday(sortedDays(state.days));
  const status = !netOnline ? 'Offline – lokale Daten' : online ? 'Live verbunden' : 'Verbinde …';

  return (
    <MapProvider>
      <div className="app">
        <header className="topbar">
          <button className="brand" onClick={() => navigate('/')}>
            <img src="/icon.svg" alt="" width={26} height={26} />
            <span>{state.trip.name}</span>
          </button>
          {pendingCount > 0 && <span className="badge orange" title="Noch nicht gesendet">{pendingCount} offline</span>}
          <span className={`dot ${online ? 'on' : 'off'}`} title={status} />
          <span className="role small muted">{ROLE_LABEL[user.role].split(' ')[0]}</span>
        </header>
        {!netOnline && <div className="offline-bar">Offline – du siehst den zuletzt geladenen Stand. Änderungen werden später gesendet.</div>}
        {(work || geocoding) && <div className="loading-bar" role="status">{[work, geocoding ? 'Stopp-Orte werden gesucht' : ''].filter(Boolean).join(' · ')} …</div>}
        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/erinnerungen" element={<Memories />} />
            <Route path="/mehr" element={<More onLogout={onLogout} />} />
            <Route path="/teilen" element={<ShareDialog />} />
            {canPlan && (
              <>
                <Route path="/tag/:dayId" element={<DayPage />} />
                <Route path="/heute" element={today ? <Navigate to={`/tag/${today.id}`} replace /> : <Navigate to="/" />} />
                <Route path="/ausgaben" element={<Expenses />} />
                <Route path="/assistent" element={<Chat />} />
                <Route path="/spielplatz" element={<Playground />} />
                <Route path="/todos" element={<Todos />} />
              </>
            )}
            {user.role === 'admin' && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <nav className="tabbar">
          <NavLink to="/" end>
            <Map size={20} />
            <span>Reise</span>
          </NavLink>
          {canPlan && (
            <NavLink to="/heute" className={({ isActive }) => (isActive || location.pathname.startsWith('/tag/') ? 'active' : '')}>
              <Navigation size={20} />
              <span>Tag</span>
            </NavLink>
          )}
          {canPlan && (
            <NavLink to="/spielplatz">
              <FlaskConical size={20} />
              <span>Spielplatz</span>
            </NavLink>
          )}
          {canPlan && (
            <NavLink to="/ausgaben">
              <Wallet size={20} />
              <span>Ausgaben</span>
            </NavLink>
          )}
          {canPlan && <NavLink to="/todos"><ListTodo size={20} /><span>Todos</span></NavLink>}
          <NavLink to="/erinnerungen">
            <Images size={20} />
            <span>Erinnerungen</span>
          </NavLink>
          {canPlan && (
            <NavLink to="/assistent" className="hide-xs">
              <Bot size={20} />
              <span>KI</span>
            </NavLink>
          )}
          <NavLink to="/mehr">
            <Menu size={20} />
            <span>Mehr</span>
          </NavLink>
        </nav>
      </div>
    </MapProvider>
  );
}
