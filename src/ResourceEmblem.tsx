const PATHS: Record<string, string> = {
  bible: "M6 4.5A2.5 2.5 0 0 1 8.5 2H20v18H8.5A2.5 2.5 0 0 0 6 22.5zM12 6v9M9.5 8.5h5M9.5 12h5",
  commentary: "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z",
  dictionary: "M5 4h10l4 4v12H5zM8 9h8M8 13h5M8 17h7",
  reference: "M5 5h14v14H5zM9 9h6M9 13h6M12 7v10",
  map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM8 7h8M8 11h6",
};

export default function ResourceEmblem({ kind, size = 20 }: { kind: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={PATHS[kind] ?? PATHS.book} stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
