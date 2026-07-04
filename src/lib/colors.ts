/** Category palette — the email analogue of WinDirStat's extension colors. */
export const CATEGORY_COLORS: Record<string, string> = {
  plain: "#4f6d8f",
  image: "#3fa66c",
  pdf: "#c2504a",
  doc: "#4a7fc2",
  sheet: "#2f9e8f",
  slides: "#c77b3d",
  archive: "#8f6dbf",
  video: "#c24a8f",
  audio: "#b0a03f",
  calendar: "#3fb0c2",
  message: "#7a8fa0",
  mixed: "#5b6c7d",
  other: "#6d7885",
};

export const CATEGORY_LABELS: Record<string, string> = {
  plain: "Plain email",
  image: "Images",
  pdf: "PDFs",
  doc: "Documents",
  sheet: "Spreadsheets",
  slides: "Presentations",
  archive: "Archives",
  video: "Video",
  audio: "Audio",
  calendar: "Invites",
  message: "Attached mail",
  mixed: "Mixed",
  other: "Other",
};

export function colorFor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other;
}

/** Deterministic hue for group tiles (senders/folders) when category is mixed. */
export function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue} 32% 46%)`;
}
