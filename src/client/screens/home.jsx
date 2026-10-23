import React from "react";
import { useApp } from "../store.jsx";
import { Icon } from "../icons.jsx";
import { Screen, Avatar, Thumb, PlayBadge, ClipView } from "../ui.jsx";
import * as S from "../sel.js";
import { todayKey, rel, greeting, WEEKDAY, MONTH, relDay, hexA, fullDay, parseKey } from "../util.js";

const { useState } = React;

const TYPE = {
  REMINDER: { icon: "clock", color: "var(--accent)", bg: "var(--accent-soft)" },
  STREAK_RISK: { icon: "flame", color: "#E07B5B", bg: "rgba(224,123,91,0.14)" },
  MASH_READY: { icon: "film", color: "#8FA6D6", bg: "rgba(143,166,214,0.14)" },
  INVITE_ACCEPTED: { icon: "userPlus", color: "#7DB39F", bg: "rgba(125,179,159,0.14)" },
  MEMBER_JOINED: { icon: "userPlus", color: "#7DB39F", bg: "rgba(125,179,159,0.14)" },
  PROJECT_INVITE: { icon: "users", color: "var(--accent)", bg: "var(--accent-soft)" },
  NEW_CLIPS: { icon: "camera", color: "#9B87D6", bg: "rgba(155,135,214,0.14)" },
  MILESTONE: { icon: "trophy", color: "#D9C04A", bg: "rgba(217,192,74,0.14)" },
  TRACK_REMOVAL_REQUEST: { icon: "music", color: "#D9768F", bg: "rgba(217,118,143,0.14)" },
  APPROVAL: { icon: "shield", color: "var(--accent)", bg: "var(--accent-soft)" },
  STORAGE_WARNING: { icon: "storage", color: "#E07B5B", bg: "rgba(224,123,91,0.14)" },
  INFO: { icon: "info", color: "var(--muted)", bg: "var(--raised)" }
};

const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

export function Notifications({ onClose }) {
  const { db, act, nav, me, toast, setMashDraft } = useApp();
  const list = db.notifications.filter((n) => n.userId === me.id).sort((a, b) => b.at - a.at);
  const DAY = 86400000;
  const today = list.filter((n) => Date.now() - n.at < DAY);
  const earlier = list.filter((n) => Date.now() - n.at >= DAY).slice(0, 12);
  const unread = list.filter((n) => !n.read).length;
  const markRead = (id) => { const x = list.find((n) => n.id === id); if (x && !x.read) act("notifRead", { id }).catch(() => {}); };
  const follow = (l) => {
    if (!l) return;
    onClose();
    if (l.route === "mash1") setMashDraft(null);
    if (l.route === "capture") { nav.go("capture"); return; }
    nav.go(l.route, l.params || {});
  };
  const respondInvite = async (n, accept) => {
    try { await act("answerProjectInvite", { projectId: n.projectId, accept }); } catch (e) { return; }
    if (accept) { toast("You joined the project"); onClose(); nav.go("project", { projectId: n.projectId }); } else toast("Invite declined");
  };
  const Item = ({ n }) => {
    const st = TYPE[n.type] || TYPE.INFO;
    const isNew = !n.read;
    const gold = n.type === "MILESTONE";
    return (
      <div style={{ background: isNew ? "#24221F" : "transparent" }}>
        <button onClick={() => { markRead(n.id); follow(n.link || (n.action && !gold ? n.action : null)); }} className="hrow gap12" style={{ width: "100%", alignItems: "flex-start", padding: "11px 16px", background: "none", border: "none", textAlign: "left", color: "inherit" }}>
          <span className={gold && isNew ? "gl-glow" : ""} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: st.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={st.icon} size={16} color={st.color} /></span>
          <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: isNew ? 700 : 500 }}>{n.title}</span>
            {n.body ? <span className="small muted" style={{ lineHeight: 1.35 }}>{n.body}</span> : null}
            <span className="tiny faint" style={{ marginTop: 2 }}>{rel(n.at)}</span>
          </span>
          {isNew ? <span style={{ width: 8, height: 8, marginTop: 5, flexShrink: 0, borderRadius: "50%", background: "var(--accent)" }} /> : null}
        </button>
        {n.action ? (
          <div style={{ padding: "0 16px 12px 62px", display: "flex" }}>
            <button className={"gold-btn" + (isNew && gold ? " new gl-shimmer" : "")} style={gold ? null : { background: "var(--raised)", borderColor: "var(--line)", color: "var(--fg)" }} onClick={() => { markRead(n.id); follow(n.action); }}>
              <Icon name={gold ? "mash" : "chevR"} size={12} stroke={2.4} />{n.action.label}
            </button>
          </div>
        ) : null}
        {n.type === "PROJECT_INVITE" && !n.answered ? (
          <div className="hrow gap8" style={{ padding: "0 16px 12px 62px" }}>
            <button className="chipbtn" onClick={() => respondInvite(n, false)}>Decline</button>
            <button className="chipbtn" style={{ background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)", fontWeight: 700 }} onClick={() => respondInvite(n, true)}>Accept</button>
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30 }}>
      <button aria-label="Close notifications" onClick={onClose} style={{ position: "absolute", inset: 0, width: "100%", background: "rgba(0,0,0,0.55)", border: "none" }} />
      <div role="dialog" aria-label="Notifications" style={{ position: "absolute", top: 66, right: 14, left: 14, maxWidth: 360, marginLeft: "auto", maxHeight: "calc(100% - 140px)", display: "flex", flexDirection: "column", borderRadius: 18, background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "0 20px 44px rgba(0,0,0,0.6)", overflow: "hidden", animation: "pop 0.15s ease-out" }}>
        <div className="hrow between" style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
          <div className="hrow gap8"><span style={{ fontSize: 15, fontWeight: 700 }}>Notifications</span>{unread ? <span className="tag accent">{unread} new</span> : null}</div>
          <button className="link" style={{ color: unread ? "var(--accent)" : "var(--ghost)" }} onClick={() => act("notifReadAll").catch(() => {})}>Mark all read</button>
        </div>
        <div className="scroll">
          {!list.length ? <div className="small faint" style={{ padding: 24, textAlign: "center" }}>Nothing yet. Milestones, finished mashes and invites show up here.</div> : null}
          {today.length ? <div className="sec" style={{ padding: "10px 16px 4px" }}>Today</div> : null}
          {today.map((n) => <Item key={n.id} n={n} />)}
          {earlier.length ? <div className="sec" style={{ padding: "12px 16px 4px", borderTop: today.length ? "1px solid var(--line-soft)" : "none", marginTop: 4 }}>Earlier</div> : null}
          {earlier.map((n) => <Item key={n.id} n={n} />)}
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>
  );
}

export function Bell({ open, onToggle }) {
  const { db, me } = useApp();
  const unread = S.unreadCount(db, me.id);
  const badge = S.prefs(db, me.id).badge;
  return (
    <button className="iconbtn" aria-label={"Notifications" + (unread ? ", " + unread + " unread" : "")} onClick={onToggle} style={{ background: open ? "#2A2825" : "var(--surface)", color: open ? "var(--fg)" : "var(--muted)" }}>
      <Icon name="bell" size={18} />
      {unread && badge === "dot" ? <span style={{ position: "absolute", top: 7, right: 7, width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", border: "1.5px solid var(--surface)" }} /> : null}
      {unread && badge === "count" ? <span className="num" style={{ position: "absolute", top: -3, right: -4, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--accent)", border: "2px solid var(--bg)", color: "var(--accent-ink)", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{unread}</span> : null}
    </button>
  );
}

export function ProjectCard({ x, onClick }) {
  return (
    <button className="pcard" onClick={onClick} style={{ background: x.cover ? (x.cover.thumb ? "url(" + x.cover.thumb + ") center/cover" : x.cover.grad) : "var(--surface)" }}>
      <span className="shade" />
      <span className="cat" style={{ color: x.cat.color }}>{x.cat.name.toUpperCase()}</span>
      {x.cat.daily && x.streak ? <span className="streak"><Icon name="flame" size={11} color="var(--accent)" />{x.streak}</span> : x.shared ? <span className="streak"><Icon name="users" size={11} color="var(--fg-2)" />{x.members.length}</span> : null}
      <span className="foot"><span className="name ellipsis" style={{ display: "block" }}>{x.p.name}</span><span className="meta" style={{ display: "block" }}>{x.count ? x.count + (x.count === 1 ? " entry" : " entries") : "No clips yet"}</span></span>
    </button>
  );
}

// Glimpses from this date in earlier years, newest year first, one per year (prefer ones with a note).
function onThisDay(db, me, visible) {
  const t = todayKey(), md = t.slice(5), yr = +t.slice(0, 4);
  const hits = db.entries.filter((e) => visible.has(e.projectId) && e.date.slice(5) === md && +e.date.slice(0, 4) < yr);
  const byYear = {};
  hits.sort((a, b) => (b.authorId === me.id) - (a.authorId === me.id) || (b.note ? 1 : 0) - (a.note ? 1 : 0)).forEach((e) => { const y = e.date.slice(0, 4); (byYear[y] = byYear[y] || []).push(e); });
  return Object.keys(byYear).sort((a, b) => b - a).map((y) => ({ years: yr - +y, list: byYear[y] }));
}

function OnThisDay({ groups }) {
  const { db, nav, me } = useApp();
  const [i, setI] = useState(0);
  const g = groups[0];
  const e = g.list[i % g.list.length];
  const m = S.media(db, e.mediaId);
  const c = S.clipOf(db, e);
  const p = S.project(db, e.projectId);
  const by = S.user(db, e.authorId);
  const mood = e.mood ? S.moodColor(db, e.authorId, e.mood) : null;
  return (
    <div className="stack gap10" style={{ marginTop: 22 }}>
      <div className="hrow between"><span className="sec">On this day</span>{g.list.length > 1 ? <span className="small faint">{(i % g.list.length) + 1} of {g.list.length}</span> : null}</div>
      <div className="hrow gap14" style={{ padding: 12, borderRadius: 18, background: "linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--surface)", border: "1px solid var(--line)", alignItems: "stretch" }}>
        <button aria-label="Open this glimpse" onClick={() => nav.go("entry", { entryId: e.id })} style={{ border: "none", padding: 0, background: "none", flexShrink: 0 }}>
          <ClipView m={m} start={c.start} end={c.start + c.len} playing loop muted style={{ width: 84, height: 112, borderRadius: 12 }} />
        </button>
        <div className="stack gap4" style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{g.years === 1 ? "One year ago today" : g.years + " years ago today"}</span>
          <span className="small muted">{fullDay(e.date)}</span>
          {e.note ? <span style={{ fontSize: 13, lineHeight: 1.4, color: "var(--fg-2)" }}>“{e.note}”</span> : null}
          <span className="hrow gap6 small muted" style={{ marginTop: 2 }}>{mood ? <span className="dot" style={{ background: mood }} /> : null}{p.name}{by.id !== me.id ? " · " + S.firstName(by) : ""}</span>
        </div>
        {g.list.length > 1 ? <button className="iconbtn" aria-label="Next glimpse from this day" onClick={() => setI(i + 1)} style={{ alignSelf: "center" }}><Icon name="chevR" size={16} /></button> : null}
      </div>
      {groups.length > 1 ? <span className="small faint">Also from {groups.slice(1).map((x) => x.years + " years ago").join(", ")}.</span> : null}
    </div>
  );
}

export function Home() {
  const { db, nav, me, setDraft } = useApp();
  const [open, setOpen] = useState(false);
  const d = new Date();
  const projects = S.sortProjects(S.myProjects(db, me.id));
  const mine = db.entries.filter((e) => e.authorId === me.id);
  const fresh = mine.length === 0;
  const dailyIds = projects.filter((x) => x.cat.daily).map((x) => x.p.id);
  const todays = db.entries.filter((e) => e.date === todayKey() && e.authorId === me.id);
  const doneDaily = todays.some((e) => dailyIds.indexOf(e.projectId) >= 0);
  const best = projects.filter((x) => x.cat.daily).sort((a, b) => b.streak - a.streak)[0];
  const visible = new Set(projects.map((x) => x.p.id));
  const recent = db.entries.filter((e) => visible.has(e.projectId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const invites = db.members.filter((m) => m.userId === me.id && m.status === "INVITED");
  const otd = !fresh && S.prefs(db, me.id).onThisDay !== false ? onThisDay(db, me, visible) : [];
  const capture = (date) => { setDraft(date ? { date } : null); nav.go("capture"); };

  return (
    <Screen tab="home">
      <div className="hrow between" style={{ padding: "22px 20px 16px", flexShrink: 0 }}>
        <div className="stack gap2">
          <span className="small muted">{WEEKDAY[d.getDay()]}, {d.getDate()} {MONTH[d.getMonth()]}</span>
          <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em" }}>{fresh ? "Welcome, " + S.firstName(me) : greeting()}</span>
        </div>
        <div className="hrow gap8">
          <Bell open={open} onToggle={() => setOpen(!open)} />
          <button className="iconbtn" aria-label="Profile" onClick={() => nav.go("profile")} style={{ padding: 0, overflow: "hidden" }}>
            {me.photo ? <Avatar user={me} size={36} ring={false} /> : <Icon name="user" size={18} color="var(--muted)" />}
          </button>
        </div>
      </div>
      <div className="scroll pad">
        {invites.map((m) => {
          const p = S.project(db, m.projectId);
          const by = S.user(db, m.invitedBy);
          return (
            <div key={m.projectId} className="stack gap12" style={{ padding: 14, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--accent)", marginBottom: 18 }}>
              <div className="hrow gap12">
                <Thumb m={S.coverOf(db, p.id)} style={{ width: 52, height: 52, borderRadius: 12 }} />
                <div className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
                  <span className="sec" style={{ color: "var(--accent)" }}>Project invite</span>
                  <span style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name}</span>
                  <span className="small muted">From {S.firstName(by)} · {plural(p.invite ? p.invite.members : S.activeMembers(db, p.id).length, "member")} · {plural(p.invite ? p.invite.clips : S.projectEntries(db, p.id).length, "clip")}</span>
                </div>
              </div>
              <InviteButtons m={m} />
            </div>
          );
        })}
        {fresh ? (
          <div className="stack gap12" style={{ alignItems: "center", textAlign: "center", padding: "26px 20px", borderRadius: 20, background: "radial-gradient(circle at 50% 0%, var(--accent-soft), transparent 70%), var(--surface)", border: "1px solid var(--line)" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}><Icon name="camera" size={28} stroke={2.2} color="var(--accent-ink)" /></span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>Take your first glimpse</span>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 260 }}>Film anything from today. You'll pick the best second next. Day one of your Diary starts here.</span>
            <button className="pill" style={{ padding: "12px 26px", fontSize: 14 }} onClick={() => capture()}>Capture now</button>
          </div>
        ) : doneDaily ? (
          <div className="hrow gap14" style={{ padding: 14, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--line)" }}>
            <Thumb m={S.media(db, todays[todays.length - 1].mediaId)} style={{ width: 58, height: 78, borderRadius: 10 }}><PlayBadge size={24} /></Thumb>
            <div className="stack gap4" style={{ flex: 1, minWidth: 0 }}>
              <span className="hrow gap6" style={{ fontSize: 15, fontWeight: 700 }}><Icon name="check" size={16} stroke={2.6} color="var(--ok)" />Today's glimpse is in</span>
              <span className="small muted">{best && best.streak ? best.streak + " day streak in " + best.p.name + ". Nice." : "Nice one."}</span>
              <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => capture()}>Add another</button>
            </div>
          </div>
        ) : (
          <div className="stack gap10" style={{ alignItems: "center", textAlign: "center", padding: "22px 18px", borderRadius: 18, border: "1.5px dashed var(--line-strong)" }}>
            <span style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="camera" size={24} color="var(--accent)" /></span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>No glimpse yet today</span>
            <span className="muted" style={{ fontSize: 12.5, maxWidth: 250, lineHeight: 1.4 }}>{best && best.streak ? "Keep your " + best.streak + " day " + best.p.name + " streak going. One second is all it takes." : "One second is all it takes to keep your diary going."}</span>
            <button className="pill" style={{ marginTop: 4 }} onClick={() => capture()}>Take today's glimpse</button>
          </div>
        )}

        {otd.length ? <OnThisDay groups={otd} /> : null}
        {fresh ? (
          <div className="stack gap10" style={{ marginTop: 22 }}>
            <span className="sec">How it works</span>
            {[["Capture a moment", "Film or pick a clip, then choose the second (or few) you want to keep."], ["File it in projects", "Your Diary for every day, or a project for a trip, a pet, a goal."], ["Mash it together", "Turn a month or a year into one short film, with music if you like."]].map((t, i) => (
              <div key={i} className="hrow gap12" style={{ alignItems: "flex-start", padding: "12px 14px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" }}>
                <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "var(--accent)" }}>{i + 1}</span>
                <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 700 }}>{t[0]}</span><span className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{t[1]}</span></span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="hrow between" style={{ marginTop: 26 }}>
          <span className="h2">Your Projects</span>
          <button className="hrow gap2 muted" onClick={() => nav.go("projects")} style={{ background: "none", border: "none", fontSize: 12.5 }}>See all<Icon name="chevR" size={13} /></button>
        </div>
        <div className="hscroll" style={{ marginTop: 12 }}>
          {projects.map((x) => <ProjectCard key={x.p.id} x={x} onClick={() => nav.go("project", { projectId: x.p.id })} />)}
          <button className="newcard" onClick={() => nav.go("projectEdit", {})}><span className="plus"><Icon name="plus" size={16} stroke={2.3} color="var(--muted)" /></span>New Project</button>
        </div>

        {recent.length ? (
          <>
            <div className="h2" style={{ marginTop: 26 }}>Recent Activity</div>
            <div className="stack" style={{ marginTop: 8 }}>
              {recent.map((e) => {
                const p = S.project(db, e.projectId);
                const by = S.user(db, e.authorId);
                return (
                  <button key={e.id} className="hrow gap12" onClick={() => nav.go("entry", { entryId: e.id })} style={{ padding: "10px 2px", background: "none", border: "none", textAlign: "left", color: "inherit" }}>
                    <Thumb m={S.media(db, e.mediaId)} style={{ width: 46, height: 46 }} />
                    <span className="stack gap2" style={{ minWidth: 0, flex: 1 }}>
                      <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{e.note || "Untitled clip"}</span>
                      <span className="small muted ellipsis">{e.authorId !== me.id ? S.firstName(by) + " · " : ""}{p.name} · {relDay(e.date)}</span>
                    </span>
                    {e.mood ? <span className="dot" style={{ background: S.moodColor(db, e.authorId, e.mood) }} title={e.mood} /> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        <div style={{ height: 16 }} />
      </div>
      {open ? <Notifications onClose={() => setOpen(false)} /> : null}
    </Screen>
  );
}

function InviteButtons({ m }) {
  const { act, nav, toast, db } = useApp();
  const answer = async (yes) => {
    try { await act("answerProjectInvite", { projectId: m.projectId, accept: yes }); } catch (e) { return; }
    if (yes) { toast("You joined " + S.project(db, m.projectId).name); nav.go("project", { projectId: m.projectId }); } else toast("Invite declined");
  };
  return (
    <div className="grid2">
      <button className="btn sm ghost" onClick={() => answer(false)}>Decline</button>
      <button className="btn sm" onClick={() => answer(true)}>Accept</button>
    </div>
  );
}
