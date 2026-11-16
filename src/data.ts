const encodeBase64 = (str: string) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return '';
};

export const PRESET_AVATARS = [
  {
    name: 'Fantasmita',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#6366f1" rx="50"/><path d="M30,70 C30,40 35,30 50,30 C65,30 70,40 70,70 C70,72 65,75 60,70 C55,65 50,75 45,70 C40,65 35,75 30,70 Z" fill="#ffffff" /><circle cx="43" cy="48" r="4" fill="#1e1b4b" /><circle cx="57" cy="48" r="4" fill="#1e1b4b" /><circle cx="39" cy="53" r="2" fill="#f43f5e" opacity="0.6" /><circle cx="61" cy="53" r="2" fill="#f43f5e" opacity="0.6" /></svg>')
  },
  {
    name: 'Cactus',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#10b981" rx="50"/><path d="M35,75 L65,75 L60,85 L40,85 Z" fill="#f97316" /><rect x="32" y="70" width="36" height="6" rx="2" fill="#ea580c" /><rect x="44" y="30" width="12" height="42" rx="6" fill="#047857" /><path d="M44,45 L36,45 C34,45 34,55 36,55 L44,55" fill="none" stroke="#047857" stroke-width="8" stroke-linecap="round" /><path d="M56,38 L64,38 C66,38 66,48 64,48 L56,48" fill="none" stroke="#047857" stroke-width="8" stroke-linecap="round" /><circle cx="47" cy="42" r="2" fill="#ffffff" /><circle cx="53" cy="42" r="2" fill="#ffffff" /><path d="M48,46 Q50,48 52,46" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>')
  },
  {
    name: 'Pinguinito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3b82f6" rx="50"/><ellipse cx="50" cy="55" rx="22" ry="25" fill="#1e293b" /><ellipse cx="50" cy="58" rx="15" ry="18" fill="#ffffff" /><ellipse cx="26" cy="55" rx="5" ry="12" fill="#1e293b" transform="rotate(-15 26 55)" /><ellipse cx="74" cy="55" rx="5" ry="12" fill="#1e293b" transform="rotate(15 74 55)" /><circle cx="44" cy="44" r="2.5" fill="#1e293b" /><circle cx="56" cy="44" r="2.5" fill="#1e293b" /><polygon points="46,47 54,47 50,53" fill="#f59e0b" /><ellipse cx="42" cy="80" rx="6" ry="3" fill="#f59e0b" /><ellipse cx="58" cy="80" rx="6" ry="3" fill="#f59e0b" /></svg>')
  },
  {
    name: 'Osito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f59e0b" rx="50"/><circle cx="32" cy="32" r="10" fill="#78350f" /><circle cx="32" cy="32" r="5" fill="#f43f5e" opacity="0.5" /><circle cx="68" cy="32" r="10" fill="#78350f" /><circle cx="68" cy="32" r="5" fill="#f43f5e" opacity="0.5" /><circle cx="50" cy="55" r="25" fill="#78350f" /><ellipse cx="50" cy="62" rx="10" ry="8" fill="#fef3c7" /><polygon points="47,58 53,58 50,62" fill="#1e293b" /><circle cx="42" cy="50" r="3" fill="#ffffff" /><circle cx="58" cy="50" r="3" fill="#ffffff" /></svg>')
  },
  {
    name: 'Gatito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ec4899" rx="50"/><polygon points="25,25 45,45 25,50" fill="#f1f5f9" /><polygon points="75,25 55,45 75,50" fill="#f1f5f9" /><polygon points="28,29 40,41 28,45" fill="#fda4af" /><polygon points="72,29 60,41 72,45" fill="#fda4af" /><ellipse cx="50" cy="55" rx="26" ry="22" fill="#f1f5f9" /><circle cx="40" cy="52" r="3" fill="#0f172a" /><circle cx="60" cy="52" r="3" fill="#0f172a" /><polygon points="48,58 53,58 50,60" fill="#fda4af" /><path d="M47,62 Q50,64 50,62 Q50,64 53,62" stroke="#0f172a" stroke-width="1.5" fill="none" /><line x1="20" y1="54" x2="30" y2="56" stroke="#cbd5e1" stroke-width="2" /><line x1="20" y1="60" x2="29" y2="60" stroke="#cbd5e1" stroke-width="2" /><line x1="80" y1="54" x2="70" y2="56" stroke="#cbd5e1" stroke-width="2" /><line x1="80" y1="60" x2="71" y2="60" stroke="#cbd5e1" stroke-width="2" /></svg>')
  },
  {
    name: 'Robot',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#06b6d4" rx="50"/><line x1="50" y1="30" x2="50" y2="18" stroke="#f1f5f9" stroke-width="4" /><circle cx="50" cy="16" r="5" fill="#f43f5e" /><rect x="28" y="28" width="44" height="38" rx="8" fill="#cbd5e1" /><rect x="34" y="34" width="32" height="20" rx="4" fill="#1e293b" /><circle cx="44" cy="44" r="3" fill="#22c55e" /><circle cx="56" cy="44" r="3" fill="#22c55e" /><rect x="42" y="60" width="16" height="2" rx="1" fill="#475569" /><rect x="24" y="40" width="4" height="14" rx="2" fill="#475569" /><rect x="72" y="40" width="4" height="14" rx="2" fill="#475569" /></svg>')
  },
  {
    name: 'Zorrito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f97316" rx="50"/><polygon points="20,25 42,42 18,50" fill="#ea580c" /><polygon points="80,25 58,42 82,50" fill="#ea580c" /><polygon points="23,28 36,39 22,44" fill="#1e293b" /><polygon points="77,28 64,39 78,44" fill="#1e293b" /><ellipse cx="36" cy="60" rx="16" ry="12" fill="#ffffff" /><ellipse cx="64" cy="60" rx="16" ry="12" fill="#ffffff" /><path d="M50,34 L28,52 C32,68 68,68 72,52 Z" fill="#ea580c" /><circle cx="38" cy="50" r="3" fill="#1e293b" /><circle cx="62" cy="50" r="3" fill="#1e293b" /><ellipse cx="50" cy="64" rx="5" ry="3.5" fill="#1e293b" /></svg>')
  },
  {
    name: 'Estrellita',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#8b5cf6" rx="50"/><path d="M50,18 L59,38 L81,41 L65,56 L69,78 L50,67 L31,78 L35,56 L19,41 L41,38 Z" fill="#fbbf24" /><circle cx="44" cy="48" r="2" fill="#1e293b" /><circle cx="56" cy="48" r="2" fill="#1e293b" /><path d="M47,53 Q50,56 53,53" stroke="#1e293b" stroke-width="1.5" fill="none" stroke-linecap="round" /><circle cx="41" cy="51" r="2" fill="#f43f5e" opacity="0.6" /><circle cx="59" cy="51" r="2" fill="#f43f5e" opacity="0.6" /></svg>')
  }
];
