import { NavLink } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Settings, Bot, LineChart } from 'lucide-react';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/live', label: 'Live Chart', icon: LineChart },
  { to: '/positions', label: 'Positions', icon: TrendingUp },
  { to: '/integrations', label: 'Integrations', icon: Settings },
  { to: '/agents', label: 'Agents', icon: Bot },
];

export default function Navbar() {
  return (
    <nav className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-xl">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shadow-lg">
              TA
            </div>
            <div>
              <span className="font-bold text-base tracking-tight">Trading Agent</span>
              <span className="text-[10px] ml-1.5 bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">DEMO</span>
            </div>
          </div>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-white/15 text-white shadow-inner'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
