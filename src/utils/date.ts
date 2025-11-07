export function formatDate(date: Date): string {
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export function sortByDate(a: { data: { date: Date } }, b: { data: { date: Date } }) {
  return b.data.date.getTime() - a.data.date.getTime();
}
