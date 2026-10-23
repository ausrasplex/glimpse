"use client";
import React from "react";
import { AppProvider, useApp } from "./store.jsx";
import { ToastHost } from "./ui.jsx";
import * as Auth from "./screens/auth.jsx";
import * as Home from "./screens/home.jsx";
import * as Capture from "./screens/capture.jsx";
import * as Cal from "./screens/calendar.jsx";
import * as Proj from "./screens/projects.jsx";
import * as Mash from "./screens/mash.jsx";
import * as Music from "./screens/music.jsx";
import * as Prof from "./screens/profile.jsx";
import * as SetS from "./screens/settings.jsx";
import * as Imm from "./screens/immich.jsx";

const ROUTES = {
  login: Auth.Login, reset: Auth.ResetPassword, signup: Auth.Signup, setup: Auth.SetupWizard,
  home: Home.Home,
  capture: Capture.Trim, immich: Imm.ImmichPicker, captureProjects: Capture.PickProjects, captureNote: Capture.NoteMood,
  calendar: Cal.Calendar, grid: Cal.Grid, entry: Cal.EntryDetail,
  projects: Proj.Projects, project: Proj.ProjectPage, projectEdit: Proj.ProjectEdit, categories: Proj.Categories, members: Proj.Members,
  mash: Mash.MashLibrary, mash1: Mash.MashStep1, mash2: Mash.MashStep2, mash3: Mash.MashStep3, player: Mash.MashPlayer, trackSection: Mash.TrackSection,
  music: Music.MusicLibrary, musicUpload: Music.MusicUpload, trackEdit: Music.TrackEdit,
  profile: Prof.Profile, reminder: Prof.ReminderEdit, moods: Prof.Moods, password: Prof.ChangePassword,
  settings: SetS.Settings
};
const PUBLIC = { login: 1, reset: 1, signup: 1, setup: 1 };

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error(err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="screen" style={{ padding: 30, gap: 14, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong on this screen</span>
        <span className="small muted" style={{ lineHeight: 1.5 }}>{String(this.state.err && this.state.err.message || this.state.err)}</span>
        <button className="btn" onClick={() => { this.setState({ err: null }); window.location.href = "/"; }}>Back to Home</button>
      </div>
    );
  }
}

function Router() {
  const { nav, me, db } = useApp();
  let cur = nav.current;
  if (!db.server.setupDone && cur.name !== "setup") cur = { name: "setup", params: {} };
  else if (!me && !PUBLIC[cur.name]) cur = { name: "login", params: cur.name === "login" ? cur.params : {} };
  else if (me && (cur.name === "login" || cur.name === "setup")) cur = { name: "home", params: {} };
  const C = ROUTES[cur.name] || Home.Home;
  return <Boundary key={cur.name}><C key={cur.name + JSON.stringify(cur.params) + nav.depth} params={cur.params || {}} /></Boundary>;
}

export default function ClientApp({ initial }) {
  // Everything is driven by the browser's URL, so render only once mounted (no server/client mismatch).
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  if (!ready) return <div className="stage"><main className="device" /></div>;
  return (
    <AppProvider initial={initial}>
      <div className="stage">
        <main className="device">
          <Router />
          <ToastHost />
        </main>
      </div>
    </AppProvider>
  );
}
