import { Route, Routes } from 'react-router-dom'
import PageShell from './components/layout/PageShell'
import Home from './pages/Home'
import Scores from './pages/Scores'
import Standings from './pages/Standings'
import Teams from './pages/Teams'
import Team from './pages/Team'
import Players from './pages/Players'
import Player from './pages/Player'
import Statistics from './pages/Statistics'
import News from './pages/News'
import WireItem from './pages/WireItem'
import Prospects from './pages/Prospects'
import ProspectProfile from './pages/ProspectProfile'
import History from './pages/History'
import GameBox from './pages/GameBox'
import Placeholder from './pages/Placeholder'

export default function App() {
  return (
    <PageShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/news" element={<News />} />
        <Route path="/news/wire/:messageId" element={<WireItem />} />
        <Route path="/scores" element={<Scores />} />
        <Route path="/scores/:gameId" element={<GameBox />} />
        <Route path="/standings" element={<Standings />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/teams/:teamId" element={<Team />} />
        <Route path="/players" element={<Players />} />
        <Route path="/players/:playerId" element={<Player />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/prospects/:prospectId" element={<ProspectProfile />} />
        <Route path="/history" element={<History />} />
        <Route
          path="/watchlist"
          element={
            <Placeholder
              title="My Watchlist"
              eyebrow="Personal, cross-device"
              note="A watchlist needs personal accounts and a database. That is a separate infrastructure decision with real cost, so it waits for your explicit approval."
            />
          }
        />
        <Route path="*" element={<Placeholder title="Not found" eyebrow="404" note="That page is not part of this build." />} />
      </Routes>
    </PageShell>
  )
}
