import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { API_MODE } from '../services/api.js'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/analyst', label: 'AI Analyst' },
  { to: '/data', label: 'Data' },
]

const NAV_LINK_CLASS = ({ isActive }) =>
  `block px-3 py-2 rounded-lg text-sm transition-colors ${
    isActive
      ? 'bg-indigo-600 text-white font-medium'
      : 'hover:bg-slate-800 hover:text-white'
  }`

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white grid place-items-center font-bold">M</span>
      <div>
        <div className="text-white font-semibold leading-tight">Mercury</div>
        <div className="text-xs text-slate-400">Seller Intelligence</div>
      </div>
    </div>
  )
}

function ApiModeBadge() {
    const isAws = API_MODE === 'aws'
  return (
    <span className={`inline-flex items-center gap-1.5 ${isAws ? 'text-emerald-400' : 'text-amber-400'}`}>
      <span className={`w-2 h-2 rounded-full ${isAws ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {isAws ? 'AWS API mode' : 'Local backend mode'}
    </span>
  )

}

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Mobile top bar (<md): brand + hamburger; the menu lists the same NavLinks. */}
      <header className="md:hidden bg-slate-900 text-slate-300 border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="p-2 rounded-lg hover:bg-slate-800 hover:text-white"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {menuOpen
                ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                : <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" className="px-3 pb-3 space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={NAV_LINK_CLASS}
              >
                {item.label}
              </NavLink>
            ))}
            <div className="px-3 py-2 text-xs">
              <ApiModeBadge />
            </div>
          </nav>
        )}
      </header>

      {/* Desktop sidebar (md+): unchanged from the original layout. */}
      <aside className="hidden md:flex w-56 shrink-0 bg-slate-900 text-slate-300 flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <Brand />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={NAV_LINK_CLASS}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-slate-800 text-xs text-slate-500">
          <ApiModeBadge />
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}

