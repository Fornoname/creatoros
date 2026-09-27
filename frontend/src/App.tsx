import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Dashboard from './pages/Dashboard'
import Position from './pages/Position'
import Topics from './pages/Topics'
import Projects from './pages/Projects'
import Radar from './pages/Radar'
import ProjectEditor from './pages/ProjectEditor'
import Materials from './pages/Materials'
import Knowledge from './pages/Knowledge'
import Publish from './pages/Publish'
import Review from './pages/Review'
import Analytics from './pages/Analytics'
import Automation from './pages/Automation'
import Settings from './pages/Settings'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/position" element={<Position />} />
          <Route path="/radar" element={<Radar />} />
          <Route path="/topics" element={<Topics />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectEditor />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/publish" element={<Publish />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/review" element={<Review />} />
          <Route path="/automation" element={<Automation />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
