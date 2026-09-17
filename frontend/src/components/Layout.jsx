import { NavLink, Outlet } from 'react-router-dom'
import { API_MODE } from '../services/api.js'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/analyst', label: 'AI Analyst' },
  { to: '/data', label: 'Data' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 bg-slate-900 text-slate-300 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white grid place-items-center font-bold">M</span>
            <div>
              <div className="text-white font-semibold leading-tight">Mercury</div>
              <div className="text-xs text-slate-400">Seller Intelligence</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-slate-800 text-xs text-slate-500">
          <span
            className={`inline-flex items-center gap-1.5 ${
              API_MODE === 'aws' ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${API_MODE === 'aws' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {API_MODE === 'aws' ? 'AWS API mode' : 'Local demo mode'}
          </span>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}
