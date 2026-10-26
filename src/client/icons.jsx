import React from "react";
import {
  ChevronLeft, ChevronRight, ChevronDown, X, Plus, Check, Camera, Bell, User, Users, UserPlus, House, Calendar, LayoutGrid,
  Clapperboard, Film, Settings, Play, Pause, Pencil, Trash2, Ellipsis, Music, Upload, Download, Eye, EyeOff, Lock, Mail, Pin,
  Archive, LogOut, AlarmClock, RotateCw, Share2, Link, Search, Trophy, SlidersVertical, Server, Database, Shield, Image,
  Volume2, Scissors, Info, TriangleAlert, Copy, Globe, KeyRound, Repeat, Tag, Heart, Layers, GripVertical, WandSparkles, Cpu, FolderOpen
} from "lucide-react";

// App icon names → Lucide icons. Screens keep using <Icon name="…" />.
const L = {
  back: ChevronLeft, chevL: ChevronLeft, chevR: ChevronRight, chevD: ChevronDown, close: X, plus: Plus, check: Check,
  camera: Camera, bell: Bell, user: User, users: Users, userPlus: UserPlus, home: House, calendar: Calendar, grid: LayoutGrid,
  mash: Clapperboard, film: Film, settings: Settings, play: Play, pause: Pause, edit: Pencil, trash: Trash2, more: Ellipsis,
  music: Music, upload: Upload, download: Download, eye: Eye, eyeOff: EyeOff, lock: Lock, mail: Mail, pin: Pin, archive: Archive,
  logout: LogOut, clock: AlarmClock, refresh: RotateCw, share: Share2, link: Link, search: Search, trophy: Trophy,
  sliders: SlidersVertical, server: Server, storage: Database, shield: Shield, image: Image, volume: Volume2, scissors: Scissors,
  info: Info, alert: TriangleAlert, copy: Copy, globe: Globe, key: KeyRound, repeat: Repeat, tag: Tag, heart: Heart,
  layers: Layers, drag: GripVertical, wand: WandSparkles, cpu: Cpu, folder: FolderOpen
};
// Solid icons: play and pause read better filled at small sizes.
const FILLED = { play: true, pause: true };

// Glimpse's own streak flame stays custom.
const CUSTOM = {
  flame: <path fill="currentColor" stroke="none" d="M12.5 2c.8 2.7-1.6 3.9-1.9 6.3-.2 1.7.9 3.2 2.6 3.2 2 0 3.3-1.7 3.3-3.8 0-1-.4-1.8-.9-2.5 1.4 1 2.4 2.9 2.4 5 0 3.6-2.9 6.3-6.5 6.3S4 14.2 4 10.6c0-3.3 2.2-5.6 4.4-7.1-.3 1.6.6 2.7 1.7 2.4.9-.2 1.2-1.1.9-2C10.6 2.9 11.5 2 12.5 2z" />
};

export function Icon({ name, size = 18, stroke = 2, color = "currentColor", style }) {
  const st = Object.assign({ color, flexShrink: 0 }, style);
  const C = L[name];
  if (C) return <C size={size} strokeWidth={stroke} color={color} fill={FILLED[name] ? "currentColor" : "none"} aria-hidden="true" style={st} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={st}>
      {CUSTOM[name] || null}
    </svg>
  );
}

// Glimpse logo C, "Clip stack".
export function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Glimpse" style={{ flexShrink: 0 }}>
      <rect width="100" height="100" rx="23" fill="#1C1B19" />
      <rect x="31" y="21" width="38" height="56" rx="9" fill="#5BA3A0" transform="rotate(-16 50 82)" />
      <rect x="31" y="21" width="38" height="56" rx="9" fill="#9B87D6" transform="rotate(16 50 82)" />
      <rect x="29.5" y="19.5" width="41" height="59" rx="10.5" fill="#1C1B19" />
      <rect x="31" y="21" width="38" height="56" rx="9" fill="#E8A33D" />
      <polygon points="44,40 44,58 58,49" fill="#141413" stroke="#141413" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
