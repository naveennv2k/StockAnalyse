import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Positions from './pages/Positions';
import Integrations from './pages/Integrations';
import AgentMonitor from './pages/AgentMonitor';
import LiveChart from './pages/LiveChart';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/live" element={<LiveChart />} />
            <Route path="/positions" element={<Positions />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/agents" element={<AgentMonitor />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
