/**
 * Every icon the platform draws, as inline SVG.
 *
 * A node's `icon` field names one of these. Adding an icon means adding one
 * entry here - no icon font, no extra dependency, no network request.
 */
const paths: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  webhook: 'M12 3a4 4 0 0 0-3.5 5.9L6 13m6-10a4 4 0 0 1 3.5 5.9L18 13M6 13a4 4 0 1 0 3.5 6H15m3-6a4 4 0 1 1-3.5 6',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0 0c2.5-2.4 3.8-5.4 3.8-9S14.5 5.4 12 3C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9zM3.5 9h17M3.5 15h17',
  pencil: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z',
  branch: 'M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 0v2a4 4 0 0 1-4 4H9',
  merge: 'M6 21V9m0 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 3h5a4 4 0 0 0 4-4V8m0 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  code: 'M8 6l-5 6 5 6m8-12l5 6-5 6',
  sheet: 'M4 4h16v16H4zM4 9h16M4 14h16M10 4v16',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  drive: 'M8 3h8l5 9-4 8H7l-4-8 5-9zM8 3l5 9M16 3l-5 9m0 0l-4 8m4-8h9',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  sparkles: 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3L12 3zM19 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v9',
};

export function Icon({ name, size = 16 }: { name?: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name ?? 'box'] ?? paths.box} />
    </svg>
  );
}

/** Small interface icons, kept apart from node icons so the two lists stay tidy. */
export const UI = {
  run: 'M8 5v14l11-7z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6L6 18M6 6l12 12',
  back: 'M19 12H5m0 0l7 7m-7-7l7-7',
  copy: 'M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  power: 'M12 3v9M18.4 6.6a9 9 0 1 1-12.7 0',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  key: 'M15 7a4 4 0 1 1-3.9 5H8v3H5v3H2v-3l6.1-6A4 4 0 0 1 15 7z',
};

export function UIIcon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
