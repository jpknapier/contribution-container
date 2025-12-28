export const formatMonthLabel = (monthId: string) => {
  const [year, month] = monthId.split('-').map(Number);
  if (!year || !month) return monthId;
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
};
