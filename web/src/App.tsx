import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Bot, CalendarDays, Map, Settings, Wallet, Images, Navigation } from 'lucide-react';
import { ROLE_LABEL } from '@neugier/shared';
import { api } from './api';
import { MapProvider } from './components/MapView';
import { findToday } from './hooks';
import { Admin } from './pages/Admin';
import { Chat } from './pages/Chat';
import { DayPage } from './pages/DayPage';
import { Expenses } from './pages/Expenses';
import { Memories } from './pages/Memories';
import { More } from './pages/More';
import { Overview } from './pages/Overview';
import { useStore } from './store';
import { sortedDays } from '@neugier/shared';

export function App({ onLogout }: { onLogout: () => void }) {
  const { state, user, online, trips } = useStore();
  const navigate = useNavigate();

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

  return (
    <MapProvider>
      <div className="app">
        <header className="topbar">
          <button className="brand" onClick={() => navigate('/')}>
            <img src="/icon.svg" alt="" width={26} height={26} />
            <span>{state.trip.name}</span>
          </button>
          <span className={`dot ${online ? 'on' : 'off'}`} title={online ? 'Live verbunden' : 'Offline'} />
          <span className="role small muted">{ROLE_LABEL[user.role]}</span>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/tag/:dayId" element={<DayPage />} />
            <Route path="/heute" element={today ? <Navigate to={`/tag/${today.id}`} replace /> : <Navigate to="/" />} />
            <Route path="/ausgaben" element={<Expenses />} />
            <Route path="/erinnerungen" element={<Memories />} />
            <Route path="/assistent" element={<Chat />} />
            <Route path="/mehr" element={<More onLogout={onLogout} />} />
            <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <nav className="tabbar">
          <NavLink to="/" end>
            <Map size={20} />
            <span>Reise</span>
          </NavLink>
          <NavLink to="/heute" className={({ isActive }) => (isActive || location.pathname === `/tag/${today?.id}` ? 'active' : '')}>
            <Navigation size={20} />
            <span>Heute</span>
          </NavLink>
          <NavLink to="/ausgaben">
            <Wallet size={20} />
            <span>Ausgaben</span>
          </NavLink>
          <NavLink to="/erinnerungen">
            <Images size={20} />
            <span>Erinnerungen</span>
          </NavLink>
          <NavLink to="/assistent">
            <Bot size={20} />
            <span>Assistent</span>
          </NavLink>
          <NavLink to="/mehr">
            {user.role === 'admin' ? <Settings size={20} /> : <CalendarDays size={20} />}
            <span>Mehr</span>
          </NavLink>
        </nav>
      </div>
    </MapProvider>
  );
}
