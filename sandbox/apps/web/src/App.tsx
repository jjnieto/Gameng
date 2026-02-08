import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useSettings } from "./lib/useSettings.ts";
import ServerControl from "./pages/ServerControl.tsx";
import ConfigEditor from "./pages/ConfigEditor.tsx";
import AdminPanel from "./pages/AdminPanel.tsx";
import PlayerView from "./pages/PlayerView.tsx";
import GameMaster from "./pages/GameMaster.tsx";
import ScenarioRunner from "./pages/ScenarioRunner.tsx";

const NAV_ITEMS = [
  { to: "/server", label: "Server" },
  { to: "/config", label: "Config" },
  { to: "/admin", label: "Admin" },
  { to: "/player", label: "Player" },
  { to: "/gm", label: "GM" },
  { to: "/scenarios", label: "Scenarios" },
] as const;

function App() {
  const [settings, updateSettings] = useSettings();

  return (
    <div className="flex min-h-screen bg-gray-900">
      {/* Sidebar */}
      <nav className="w-48 shrink-0 bg-gray-950 border-r border-gray-800 p-4">
        <h1 className="text-lg font-bold text-white mb-6">Gameng</h1>
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `block rounded px-3 py-2 text-sm ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/server" replace />} />
          <Route
            path="/server"
            element={
              <ServerControl
                settings={settings}
                onUpdateSettings={updateSettings}
              />
            }
          />
          <Route path="/config" element={<ConfigEditor settings={settings} />} />
          <Route
            path="/admin"
            element={
              <AdminPanel
                settings={settings}
                onUpdateSettings={updateSettings}
              />
            }
          />
          <Route path="/player" element={<PlayerView settings={settings} />} />
          <Route path="/gm" element={<GameMaster settings={settings} />} />
          <Route path="/scenarios" element={<ScenarioRunner settings={settings} />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
