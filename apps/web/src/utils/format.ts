export function formatDate(value?: string | null) {
  if (!value) {
    return "Kein Datum";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium"
  }).format(date);
}

export function compactId(id: string) {
  return id.length <= 10 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
}

export function labelForPhotoType(type: string) {
  const labels: Record<string, string> = {
    portrait: "Portrait",
    sibling: "Geschwister",
    class: "Klasse",
    classMirror: "Klassenspiegel",
    event: "Anlass"
  };
  return labels[type] ?? type;
}
